import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  comments,
  courses,
  lessons,
  purchases,
  refunds,
  users,
  RefundStatus,
} from "~/db/schema";
import {
  NOTIFICATION_SETTINGS_URL,
  type SummaryPart,
} from "~/lib/notifications";
import { absoluteUrl } from "~/lib/app-url.server";
import { formatPrice } from "~/lib/utils";
import {
  configuredNotificationProvider,
  type NotificationEmail,
  type NotificationProvider,
} from "~/lib/notification-provider.server";

// ─── Notifications ───
// Everything about Notifications except delivering them: who gets one, what it
// says and where it links. Delivery belongs to the Notification Provider
// (ADR 0013). There is one function per kind of Notification.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

type Db = BetterSQLite3Database<typeof schema>;

function getCommentWithAuthor(db: Db, commentId: number) {
  return db
    .select({
      id: comments.id,
      parentId: comments.parentId,
      lessonId: comments.lessonId,
      body: comments.body,
      authorId: users.id,
      authorName: users.name,
      authorEmail: users.email,
      authorAvatarUrl: users.avatarUrl,
      authorEmailAndPopUps: users.emailAndPopUps,
    })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .where(eq(comments.id, commentId))
    .get();
}

function getCourse(db: Db, courseId: number) {
  return db
    .select({
      title: courses.title,
      slug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
}

function getLesson(db: Db, lessonId: number) {
  return db
    .select({ id: lessons.id, title: lessons.title })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();
}

// ─── Wording ───

type Course = { title: string; slug: string };
type Lesson = { id: number; title: string };

// Discussion Questions and Discussion Replies live on a lesson. If the lesson
// has gone, the Notification names the course and links to the course page.

function discussionReplySummary(
  replierName: string,
  course: Course,
  lesson: Lesson | undefined
): SummaryPart[] {
  return [
    { text: replierName, strong: true },
    { text: " replied to your Discussion Question on " },
    { text: lesson?.title ?? course.title, strong: true },
  ];
}

type CommentWithAuthor = NonNullable<ReturnType<typeof getCommentWithAuthor>>;

// Plain text, like Cadence's other transactional email. The switch can stop
// this email, so it ends with a footer line linking to Notification settings.
function discussionReplyEmail(
  question: CommentWithAuthor,
  reply: CommentWithAuthor,
  course: Course,
  lesson: Lesson | undefined
): NotificationEmail {
  const where = lesson
    ? `"${lesson.title}" in "${course.title}"`
    : `"${course.title}"`;

  return {
    subject: `${reply.authorName} replied to your Discussion Question on ${lesson?.title ?? course.title}`,
    body: [
      `Hi ${question.authorName},`,
      "",
      `${reply.authorName} replied to your Discussion Question on ${where}:`,
      "",
      quote(reply.body),
      "",
      `View it on Cadence: ${absoluteUrl(discussionLink(course, lesson, reply.id))}`,
      "",
      "— The Cadence team",
      "",
      `To stop these emails, turn off email and pop-ups in Notification settings: ${absoluteUrl(NOTIFICATION_SETTINGS_URL)}`,
    ].join("\n"),
  };
}

// Plain-text email quotes a passage by starting each of its lines with ">".
function quote(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

// Every comment on the lesson page carries an id="comment-<id>" anchor.
function discussionLink(
  course: Course,
  lesson: Lesson | undefined,
  commentId: number
): string {
  if (!lesson) return `/courses/${course.slug}`;
  return `/courses/${course.slug}/lessons/${lesson.id}#comment-${commentId}`;
}

// ─── One function per kind ───

/**
 * Tells a Discussion Question's author that someone posted a Discussion Reply
 * to it. Call it once the reply is saved. It never throws: a failure is logged,
 * so the reply still gets posted. The provider defaults to the configured one.
 */
export async function notifyDiscussionReply(
  db: Db,
  courseId: number,
  discussionReplyId: number,
  provider?: NotificationProvider
): Promise<void> {
  try {
    const reply = getCommentWithAuthor(db, discussionReplyId);
    if (!reply || reply.parentId === null) return;

    const question = getCommentWithAuthor(db, reply.parentId);
    const course = getCourse(db, courseId);
    const lesson = getLesson(db, reply.lessonId);
    if (!question || !course) return;

    // The Instructor's own top-level comment isn't a Discussion Question, so a
    // reply to it isn't a Discussion Reply.
    if (question.authorId === course.instructorId) return;

    // Nobody hears about their own action.
    if (question.authorId === reply.authorId) return;

    await (provider ?? configuredNotificationProvider()).send({
      kind: "discussion-reply",
      recipients: [{ id: question.authorId, email: question.authorEmail }],
      actor: { name: reply.authorName, avatarUrl: reply.authorAvatarUrl },
      content: {
        summary: discussionReplySummary(reply.authorName, course, lesson),
        excerpt: reply.body,
        context: course.title,
        url: discussionLink(course, lesson, reply.id),
        // The author's switch drops the email, and only the email.
        email: question.authorEmailAndPopUps
          ? discussionReplyEmail(question, reply, course, lesson)
          : undefined,
      },
    });
  } catch (error) {
    console.error(
      `Couldn't send the Discussion Reply Notification for comment ${discussionReplyId}`,
      error
    );
  }
}

// ─── Refund Request decided ───

// The buyer is whoever paid: the Student for an Individual Purchase, the Team
// Admin for a Team Licence.
function getRefundRequestWithBuyer(db: Db, refundRequestId: number) {
  return db
    .select({
      status: refunds.status,
      decisionNote: refunds.decisionNote,
      // Set once approved: the Refund, which is the full amount paid.
      amountRefunded: refunds.amountRefunded,
      decidedById: refunds.resolvedByUserId,
      courseTitle: courses.title,
      buyerId: users.id,
      buyerName: users.name,
      buyerEmail: users.email,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .where(eq(refunds.id, refundRequestId))
    .get();
}

type RefundRequestWithBuyer = NonNullable<
  ReturnType<typeof getRefundRequestWithBuyer>
>;

// The buyer's Refund Requests, on the settings page under the
// id="refund-requests" anchor.
const REFUND_REQUESTS_URL = "/settings#refund-requests";

function refundRequestDecidedSummary(
  refundRequest: RefundRequestWithBuyer
): SummaryPart[] {
  const yourRefundRequest: SummaryPart[] = [
    { text: "Your Refund Request for " },
    { text: refundRequest.courseTitle, strong: true },
  ];

  if (refundRequest.status !== RefundStatus.Approved) {
    return [...yourRefundRequest, { text: " was declined." }];
  }

  return [
    ...yourRefundRequest,
    { text: " was approved. " },
    { text: formatPrice(refundRequest.amountRefunded), strong: true },
    { text: " is on its way back to you." },
  ];
}

function refundRequestDecidedEmail(
  refundRequest: RefundRequestWithBuyer
): NotificationEmail {
  const { courseTitle, decisionNote } = refundRequest;
  const approved = refundRequest.status === RefundStatus.Approved;

  const decision = approved
    ? `Your Refund Request for "${courseTitle}" was approved. ${formatPrice(refundRequest.amountRefunded)} is on its way back to you.`
    : `Your Refund Request for "${courseTitle}" was declined.`;
  const note = decisionNote ? ["", decisionNote] : [];
  const whatNext = approved
    ? []
    : [
        "",
        "You still have everything you bought. If something changes, you can raise a new Refund Request.",
      ];

  return {
    subject: `Your Refund Request for ${courseTitle} was ${approved ? "approved" : "declined"}`,
    body: [
      `Hi ${refundRequest.buyerName},`,
      "",
      decision,
      ...note,
      ...whatNext,
      "",
      `See your Refund Requests on Cadence: ${absoluteUrl(REFUND_REQUESTS_URL)}`,
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

/**
 * Tells the buyer that a Platform Admin approved or declined their Refund
 * Request, in-app and by email. Call it once the decision is saved. It never
 * throws: a failure is logged, so the decision still stands. The provider
 * defaults to the configured one.
 */
export async function notifyRefundRequestDecided(
  db: Db,
  refundRequestId: number,
  provider?: NotificationProvider
): Promise<void> {
  try {
    const refundRequest = getRefundRequestWithBuyer(db, refundRequestId);
    if (!refundRequest || refundRequest.status === RefundStatus.Open) return;

    // Nobody hears about their own action.
    if (refundRequest.decidedById === refundRequest.buyerId) return;

    await (provider ?? configuredNotificationProvider()).send({
      kind: "refund-request-decided",
      recipients: [
        { id: refundRequest.buyerId, email: refundRequest.buyerEmail },
      ],
      actor: null,
      content: {
        summary: refundRequestDecidedSummary(refundRequest),
        excerpt: refundRequest.decisionNote,
        context: refundRequest.courseTitle,
        url: REFUND_REQUESTS_URL,
        // Always, whatever the buyer's switch says: it carries the money
        // details.
        email: refundRequestDecidedEmail(refundRequest),
      },
    });
  } catch (error) {
    console.error(
      `Couldn't send the Refund Request decided Notification for Refund Request ${refundRequestId}`,
      error
    );
  }
}
