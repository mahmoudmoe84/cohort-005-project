import { and, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  comments,
  coupons,
  courses,
  lessons,
  purchases,
  refunds,
  sentNotifications,
  users,
  RefundStatus,
  UserRole,
} from "~/db/schema";
import {
  NOTIFICATION_SETTINGS_URL,
  type NotificationKind,
  type SummaryPart,
} from "~/lib/notifications";
import { absoluteUrl } from "~/lib/app-url.server";
import { formatPrice } from "~/lib/utils";
import {
  configuredNotificationProvider,
  type NotificationEmail,
  type NotificationProvider,
  type NotificationSend,
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

function getRecipient(db: Db, userId: number) {
  return db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

function getPlatformAdmins(db: Db) {
  return db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, UserRole.Admin))
    .all();
}

// The buyer is whoever paid: the Student for an Individual Purchase, the Team
// Admin for a Team Licence.
function getRefundRequestWithBuyer(db: Db, refundRequestId: number) {
  return db
    .select({
      id: refunds.id,
      status: refunds.status,
      reason: refunds.reason,
      decisionNote: refunds.decisionNote,
      decidedById: refunds.resolvedByUserId,
      amountPaid: purchases.amountPaid,
      courseTitle: courses.title,
      buyerId: users.id,
      buyerName: users.name,
      buyerEmail: users.email,
      buyerAvatarUrl: users.avatarUrl,
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

// Finds nothing until a Student has claimed the Seat. The Team Admin is
// whoever bought the Team Licence the Seat is on.
function getClaimedSeat(db: Db, seatId: number) {
  return db
    .select({
      teamLicenceId: coupons.purchaseId,
      teamAdminId: purchases.userId,
      courseTitle: courses.title,
      studentId: users.id,
      studentName: users.name,
      studentAvatarUrl: users.avatarUrl,
    })
    .from(coupons)
    .innerJoin(users, eq(coupons.redeemedByUserId, users.id))
    .innerJoin(purchases, eq(coupons.purchaseId, purchases.id))
    .innerJoin(courses, eq(coupons.courseId, courses.id))
    .where(eq(coupons.id, seatId))
    .get();
}

// Counted on the one Team Licence, not across every Team Licence the team
// holds for the course.
function countSeats(db: Db, teamLicenceId: number) {
  const seats = db
    .select({ redeemedAt: coupons.redeemedAt })
    .from(coupons)
    .where(eq(coupons.purchaseId, teamLicenceId))
    .all();
  return {
    total: seats.length,
    unclaimed: seats.filter((seat) => seat.redeemedAt === null).length,
  };
}

// ─── Wording ───

type Course = { title: string; slug: string };
type Lesson = { id: number; title: string };

// Discussion Questions and Discussion Replies live on a lesson. If the lesson
// has gone, the Notification names the course and links to the course page.

function discussionQuestionSummary(
  askerName: string,
  course: Course,
  lesson: Lesson | undefined
): SummaryPart[] {
  return [
    { text: askerName, strong: true },
    { text: " asked a Discussion Question on " },
    { text: lesson?.title ?? course.title, strong: true },
  ];
}

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

// A Refund is always the full amount the buyer paid, so that's what they're
// asking for.
function openRefundRequestSummary(
  buyerName: string,
  courseTitle: string,
  amountPaid: number
): SummaryPart[] {
  return [
    { text: buyerName, strong: true },
    { text: " asked for a refund on " },
    { text: courseTitle, strong: true },
    { text: ` (${formatPrice(amountPaid)})` },
  ];
}

// The Seats left are the Team Licence's Unclaimed Seats.
function seatClaimedSummary(
  studentName: string,
  courseTitle: string,
  seats: { total: number; unclaimed: number }
): SummaryPart[] {
  const noun = seats.total === 1 ? "Seat" : "Seats";
  return [
    { text: studentName, strong: true },
    { text: " claimed a Seat on " },
    { text: courseTitle, strong: true },
    { text: `. ${seats.unclaimed} of ${seats.total} ${noun} left.` },
  ];
}

// The buyer's Refund Requests, on the settings page under the
// id="refund-requests" anchor.
const REFUND_REQUESTS_URL = "/settings#refund-requests";

// Signed by Cadence, not the Platform Admin. An approval says what's on its
// way back: the Refund, which is always the full amount the buyer paid.
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
    { text: formatPrice(refundRequest.amountPaid), strong: true },
    { text: " is on its way back to you." },
  ];
}

// Plain text, like Cadence's other transactional email. The switch can't stop
// this email, so unlike the Discussion Reply email it has no footer pointing
// at Notification settings.
function refundRequestDecidedEmail(
  refundRequest: RefundRequestWithBuyer
): NotificationEmail {
  const { courseTitle, decisionNote } = refundRequest;
  const approved = refundRequest.status === RefundStatus.Approved;

  const decision = approved
    ? `Your Refund Request for "${courseTitle}" was approved. ${formatPrice(refundRequest.amountPaid)} is on its way back to you.`
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

// ─── Sending ───

/**
 * What a Notification is about, as stored with each send: a comment or a
 * Refund Request. Seat claimed is about the team page as a whole.
 */
type SentAbout = { commentId?: number; refundRequestId?: number };

// The Notification itself stays at the Notification Provider. Cadence stores
// the send's workflow run id for each recipient, so it can mark their copy
// read once they open the page it links to.
async function send(
  db: Db,
  notification: NotificationSend,
  about: SentAbout,
  provider: NotificationProvider = configuredNotificationProvider()
): Promise<void> {
  const workflowRunId = await provider.send(notification);
  db.insert(sentNotifications)
    .values(
      notification.recipients.map((recipient) => ({
        recipientId: recipient.id,
        kind: notification.kind,
        ...about,
        workflowRunId,
      }))
    )
    .run();
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

    await send(
      db,
      {
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
      },
      { commentId: reply.id },
      provider
    );
  } catch (error) {
    console.error(
      `Couldn't send the Discussion Reply Notification for comment ${discussionReplyId}`,
      error
    );
  }
}

/**
 * Tells the course's Instructor that someone asked a Discussion Question on
 * one of their lessons. Call it once the top-level comment is saved. It never
 * throws: a failure is logged, so the comment still gets posted. The provider
 * defaults to the configured one.
 */
export async function notifyDiscussionQuestion(
  db: Db,
  courseId: number,
  discussionQuestionId: number,
  provider?: NotificationProvider
): Promise<void> {
  try {
    const question = getCommentWithAuthor(db, discussionQuestionId);
    const course = getCourse(db, courseId);
    if (!question || question.parentId !== null || !course) return;

    // The Instructor's own top-level comment isn't a Discussion Question, and
    // nobody hears about their own action.
    if (question.authorId === course.instructorId) return;

    const lesson = getLesson(db, question.lessonId);
    const instructor = getRecipient(db, course.instructorId);
    if (!instructor) return;

    await send(
      db,
      {
        kind: "discussion-question",
        recipients: [instructor],
        actor: {
          name: question.authorName,
          avatarUrl: question.authorAvatarUrl,
        },
        content: {
          summary: discussionQuestionSummary(
            question.authorName,
            course,
            lesson
          ),
          excerpt: question.body,
          context: course.title,
          url: discussionLink(course, lesson, question.id),
        },
      },
      { commentId: question.id },
      provider
    );
  } catch (error) {
    console.error(
      `Couldn't send the Discussion Question Notification for comment ${discussionQuestionId}`,
      error
    );
  }
}

/**
 * Tells every Platform Admin that a buyer raised a Refund Request, so one of
 * them can decide it. Call it once the Refund Request is saved. It never
 * throws: a failure is logged, so the Refund Request still gets raised. The
 * provider defaults to the configured one.
 */
export async function notifyOpenRefundRequest(
  db: Db,
  refundRequestId: number,
  provider?: NotificationProvider
): Promise<void> {
  try {
    const refundRequest = getRefundRequestWithBuyer(db, refundRequestId);
    if (!refundRequest) return;

    // Nobody hears about their own action, even a Platform Admin who asks for
    // their own money back.
    const platformAdmins = getPlatformAdmins(db).filter(
      (platformAdmin) => platformAdmin.id !== refundRequest.buyerId
    );
    if (platformAdmins.length === 0) return;

    await send(
      db,
      {
        kind: "open-refund-request",
        recipients: platformAdmins,
        actor: {
          name: refundRequest.buyerName,
          avatarUrl: refundRequest.buyerAvatarUrl,
        },
        content: {
          summary: openRefundRequestSummary(
            refundRequest.buyerName,
            refundRequest.courseTitle,
            refundRequest.amountPaid
          ),
          excerpt: refundRequest.reason,
          context: refundRequest.courseTitle,
          // The review page, which shows Open Refund Requests unless told
          // otherwise.
          url: "/admin/refunds",
        },
      },
      { refundRequestId: refundRequest.id },
      provider
    );
  } catch (error) {
    console.error(
      `Couldn't send the Open Refund Request Notification for Refund Request ${refundRequestId}`,
      error
    );
  }
}

/**
 * Tells the Team Admin who bought a Team Licence that a Student claimed one of
 * its Seats, and how many are left. Call it once the claim is saved. It never
 * throws: a failure is logged, so the Student still gets their Enrollment.
 * The provider defaults to the configured one.
 */
export async function notifySeatClaimed(
  db: Db,
  seatId: number,
  provider?: NotificationProvider
): Promise<void> {
  try {
    const seat = getClaimedSeat(db, seatId);
    if (!seat) return;

    // Nobody hears about their own action, so a Team Admin who claims one of
    // their own Seats isn't told.
    if (seat.studentId === seat.teamAdminId) return;

    const teamAdmin = getRecipient(db, seat.teamAdminId);
    if (!teamAdmin) return;

    await send(
      db,
      {
        kind: "seat-claimed",
        recipients: [teamAdmin],
        actor: { name: seat.studentName, avatarUrl: seat.studentAvatarUrl },
        content: {
          summary: seatClaimedSummary(
            seat.studentName,
            seat.courseTitle,
            countSeats(db, seat.teamLicenceId)
          ),
          excerpt: null,
          context: seat.courseTitle,
          url: "/team",
        },
      },
      // About the team page as a whole.
      {},
      provider
    );
  } catch (error) {
    console.error(
      `Couldn't send the Seat claimed Notification for Seat ${seatId}`,
      error
    );
  }
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

    // Nobody hears about their own action, even a Platform Admin who decides
    // their own Refund Request.
    if (refundRequest.decidedById === refundRequest.buyerId) return;

    await send(
      db,
      {
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
      },
      { refundRequestId: refundRequest.id },
      provider
    );
  } catch (error) {
    console.error(
      `Couldn't send the Refund Request decided Notification for Refund Request ${refundRequestId}`,
      error
    );
  }
}

// ─── Marking read ───

/**
 * A page that Notifications link to. Opening it marks the person's
 * Notifications about what's on it read.
 */
export type LinkedPage =
  | { page: "lesson"; lessonId: number }
  /** The buyer's Refund Requests, in settings. */
  | { page: "refund-requests" }
  | { page: "refund-request-review" }
  | { page: "team" };

// Every page but the lesson shows everything its one kind of Notification is
// about, so it marks all of them.
const KIND_LINKING_TO = {
  "refund-requests": "refund-request-decided",
  "refund-request-review": "open-refund-request",
  team: "seat-claimed",
} satisfies Record<Exclude<LinkedPage["page"], "lesson">, NotificationKind>;

// The person's own Notifications about the page, and nobody else's, that
// Cadence hasn't had marked read yet.
function findNotificationsToMark(db: Db, userId: number, page: LinkedPage) {
  const theirsToMark = and(
    eq(sentNotifications.recipientId, userId),
    isNull(sentNotifications.markedReadAt)
  );
  const columns = {
    id: sentNotifications.id,
    workflowRunId: sentNotifications.workflowRunId,
  };

  // Discussion Questions and Discussion Replies on that lesson.
  if (page.page === "lesson") {
    return db
      .select(columns)
      .from(sentNotifications)
      .innerJoin(comments, eq(sentNotifications.commentId, comments.id))
      .where(and(theirsToMark, eq(comments.lessonId, page.lessonId)))
      .all();
  }

  return db
    .select(columns)
    .from(sentNotifications)
    .where(
      and(theirsToMark, eq(sentNotifications.kind, KIND_LINKING_TO[page.page]))
    )
    .all();
}

/**
 * Marks the signed-in person's Notifications about a page read once they open
 * it, however they got there. Call it from the page's loader. The Notification
 * Provider is asked once per Notification. It never throws: a failure is
 * logged, so the page still opens, and that Notification is tried again the
 * next time. The provider defaults to the configured one.
 */
export async function markNotificationsRead(
  db: Db,
  userId: number,
  page: LinkedPage,
  provider?: NotificationProvider
): Promise<void> {
  const toMark = findNotificationsToMark(db, userId, page);
  for (const { id, workflowRunId } of toMark) {
    try {
      await (provider ?? configuredNotificationProvider()).markRead({
        workflowRunId,
        userId,
      });
      db.update(sentNotifications)
        .set({ markedReadAt: new Date().toISOString() })
        .where(eq(sentNotifications.id, id))
        .run();
    } catch (error) {
      console.error(
        `Couldn't mark the Notification from workflow run ${workflowRunId} read for user ${userId}`,
        error
      );
    }
  }
}
