import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
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
  type FeedCredentials,
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
  discussionQuestion: CommentWithAuthor,
  discussionReply: CommentWithAuthor,
  course: Course,
  lesson: Lesson | undefined
): NotificationEmail {
  const where = lesson
    ? `"${lesson.title}" in "${course.title}"`
    : `"${course.title}"`;

  return {
    subject: `${discussionReply.authorName} replied to your Discussion Question on ${lesson?.title ?? course.title}`,
    body: [
      `Hi ${discussionQuestion.authorName},`,
      "",
      `${discussionReply.authorName} replied to your Discussion Question on ${where}:`,
      "",
      quote(discussionReply.body),
      "",
      `View it on Cadence: ${absoluteUrl(discussionLink(course, lesson, discussionReply.id))}`,
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

// ─── Never breaking what caused it ───

/**
 * Runs `work`, and if it throws, logs `failure` with the error and gives
 * undefined instead. Sending a Notification or marking one read never breaks
 * the action that caused it or the page being opened.
 */
async function logInsteadOfThrowing<T>(
  failure: string,
  work: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await work();
  } catch (error) {
    console.error(failure, error);
    return undefined;
  }
}

// ─── One function per kind ───

/**
 * Tells a Discussion Question's author that someone posted a Discussion Reply
 * to it. Call it once the Discussion Reply is saved. It never throws: a
 * failure is logged, so the Discussion Reply still gets posted. The provider
 * defaults to the configured one.
 */
export async function notifyDiscussionReply(
  db: Db,
  courseId: number,
  discussionReplyId: number,
  provider?: NotificationProvider
): Promise<void> {
  await logInsteadOfThrowing(
    `Couldn't send the Discussion Reply Notification for comment ${discussionReplyId}`,
    async () => {
      const discussionReply = getCommentWithAuthor(db, discussionReplyId);
      if (!discussionReply || discussionReply.parentId === null) return;

      const discussionQuestion = getCommentWithAuthor(
        db,
        discussionReply.parentId
      );
      const course = getCourse(db, courseId);
      const lesson = getLesson(db, discussionReply.lessonId);
      if (!discussionQuestion || !course) return;

      // The Instructor's own top-level comment isn't a Discussion Question, so
      // a comment answering it isn't a Discussion Reply.
      if (discussionQuestion.authorId === course.instructorId) return;

      // Nobody hears about their own action.
      if (discussionQuestion.authorId === discussionReply.authorId) return;

      await send(
        db,
        {
          kind: "discussion-reply",
          recipients: [
            {
              id: discussionQuestion.authorId,
              email: discussionQuestion.authorEmail,
            },
          ],
          actor: {
            name: discussionReply.authorName,
            avatarUrl: discussionReply.authorAvatarUrl,
          },
          content: {
            summary: discussionReplySummary(
              discussionReply.authorName,
              course,
              lesson
            ),
            excerpt: discussionReply.body,
            context: course.title,
            url: discussionLink(course, lesson, discussionReply.id),
            // The author's switch drops the email, and only the email.
            email: discussionQuestion.authorEmailAndPopUps
              ? discussionReplyEmail(
                  discussionQuestion,
                  discussionReply,
                  course,
                  lesson
                )
              : undefined,
          },
        },
        { commentId: discussionReply.id },
        provider
      );
    }
  );
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
  await logInsteadOfThrowing(
    `Couldn't send the Discussion Question Notification for comment ${discussionQuestionId}`,
    async () => {
      const discussionQuestion = getCommentWithAuthor(db, discussionQuestionId);
      const course = getCourse(db, courseId);
      if (!discussionQuestion || !course) return;

      // A comment with a parent answers a Discussion Question instead.
      if (discussionQuestion.parentId !== null) return;

      // The Instructor's own top-level comment isn't a Discussion Question, and
      // nobody hears about their own action.
      if (discussionQuestion.authorId === course.instructorId) return;

      const lesson = getLesson(db, discussionQuestion.lessonId);
      const instructor = getRecipient(db, course.instructorId);
      if (!instructor) return;

      await send(
        db,
        {
          kind: "discussion-question",
          recipients: [instructor],
          actor: {
            name: discussionQuestion.authorName,
            avatarUrl: discussionQuestion.authorAvatarUrl,
          },
          content: {
            summary: discussionQuestionSummary(
              discussionQuestion.authorName,
              course,
              lesson
            ),
            excerpt: discussionQuestion.body,
            context: course.title,
            url: discussionLink(course, lesson, discussionQuestion.id),
          },
        },
        { commentId: discussionQuestion.id },
        provider
      );
    }
  );
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
  await logInsteadOfThrowing(
    `Couldn't send the Open Refund Request Notification for Refund Request ${refundRequestId}`,
    async () => {
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
    }
  );
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
  await logInsteadOfThrowing(
    `Couldn't send the Seat claimed Notification for Seat ${seatId}`,
    async () => {
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
    }
  );
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
  await logInsteadOfThrowing(
    `Couldn't send the Refund Request decided Notification for Refund Request ${refundRequestId}`,
    async () => {
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
    }
  );
}

// ─── Connecting to the Notification Feed ───

/**
 * What the browser needs to connect to the person's Notification Feed, or
 * null when the Notification Provider can't say. Every page's layout asks for
 * it, so it never throws: a failure is logged and the page opens without the
 * bell. The provider defaults to the configured one.
 */
export async function notificationFeedCredentials(
  userId: number,
  provider?: NotificationProvider
): Promise<FeedCredentials | null> {
  const credentials = await logInsteadOfThrowing(
    `Couldn't get the Notification Feed credentials for user ${userId}`,
    () => (provider ?? configuredNotificationProvider()).feedCredentials(userId)
  );
  return credentials ?? null;
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
  | {
      page: "refund-request-review";
      /** The Refund Requests it shows. It shows one status at a time. */
      refundRequestIds: number[];
    }
  | { page: "team" };

// Opening a page waits at most this long for the Notification Provider,
// however many Notifications it marks read. Tries still going after that
// finish in the background.
const MARK_READ_WAIT_MS = 1_000;

// Cadence asks the Notification Provider to mark a Notification read at most
// this many times. Some can never be marked, such as one older than Knock's
// message log, and those would otherwise be asked about on every visit.
const MARK_READ_ATTEMPTS = 3;

// The person's own Notifications about what the page shows, and nobody
// else's, that Cadence hasn't had marked read yet and hasn't given up on.
function findNotificationsToMark(db: Db, userId: number, page: LinkedPage) {
  const theirsToMark = and(
    eq(sentNotifications.recipientId, userId),
    isNull(sentNotifications.markedReadAt),
    lt(sentNotifications.markReadAttempts, MARK_READ_ATTEMPTS)
  );
  const columns = {
    id: sentNotifications.id,
    workflowRunId: sentNotifications.workflowRunId,
  };
  const everyOne = (kind: NotificationKind) =>
    db
      .select(columns)
      .from(sentNotifications)
      .where(and(theirsToMark, eq(sentNotifications.kind, kind)))
      .all();

  switch (page.page) {
    // Discussion Questions and Discussion Replies on that lesson.
    case "lesson":
      return db
        .select(columns)
        .from(sentNotifications)
        .innerJoin(comments, eq(sentNotifications.commentId, comments.id))
        .where(and(theirsToMark, eq(comments.lessonId, page.lessonId)))
        .all();

    // Only the Open Refund Requests it shows.
    case "refund-request-review":
      return db
        .select(columns)
        .from(sentNotifications)
        .where(
          and(
            theirsToMark,
            eq(sentNotifications.kind, "open-refund-request"),
            inArray(sentNotifications.refundRequestId, page.refundRequestIds)
          )
        )
        .all();

    // It shows all the buyer's Refund Requests.
    case "refund-requests":
      return everyOne("refund-request-decided");

    // Seat claimed is about the team page as a whole.
    case "team":
      return everyOne("seat-claimed");
  }
}

/**
 * Marks the signed-in person's Notifications about a page read once they open
 * it, however they got there. Call it from the page's loader. It asks the
 * Notification Provider about them all at once, and waits for it at most a
 * second, so the page never stalls. A Notification that's marked isn't asked
 * about again, and one that isn't is tried again the next time, up to three
 * tries. It never throws: a failure is logged, so the page still opens. The
 * provider defaults to the configured one.
 */
export async function markNotificationsRead(
  db: Db,
  userId: number,
  page: LinkedPage,
  provider?: NotificationProvider
): Promise<void> {
  await logInsteadOfThrowing(
    `Couldn't mark the Notifications on the ${page.page} page read for user ${userId}`,
    async () => {
      const toMark = findNotificationsToMark(db, userId, page);
      if (toMark.length === 0) return;

      const markingProvider = provider ?? configuredNotificationProvider();
      countAttempts(db, toMark);
      const marking = toMark.map((sent) =>
        markOneRead(db, sent, userId, markingProvider)
      );
      await waitAtMost(MARK_READ_WAIT_MS, Promise.all(marking));
    }
  );
}

// Counted as the tries start, so a try that never finishes counts too.
function countAttempts(db: Db, toMark: { id: number }[]) {
  const ids = toMark.map((sent) => sent.id);
  db.update(sentNotifications)
    .set({ markReadAttempts: sql`${sentNotifications.markReadAttempts} + 1` })
    .where(inArray(sentNotifications.id, ids))
    .run();
}

// Resolves once the work is done or `ms` have passed, whichever comes first.
// The work carries on either way.
function waitAtMost(ms: number, work: Promise<unknown>): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    work.then(done, done);
  });
}

// Never throws, so one Notification that can't be marked doesn't stop the
// rest. Unless that was its last try, it's asked about again the next time.
async function markOneRead(
  db: Db,
  sent: { id: number; workflowRunId: string },
  userId: number,
  provider: NotificationProvider
): Promise<void> {
  await logInsteadOfThrowing(
    `Couldn't mark the Notification from workflow run ${sent.workflowRunId} read for user ${userId}`,
    async () => {
      await provider.markRead({
        workflowRunId: sent.workflowRunId,
        userId,
      });
      db.update(sentNotifications)
        .set({ markedReadAt: new Date().toISOString() })
        .where(eq(sentNotifications.id, sent.id))
        .run();
    }
  );
}
