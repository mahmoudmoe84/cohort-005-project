import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { db } from "~/db";
import {
  courses,
  coupons,
  enrollments,
  lessonProgress,
  lessons,
  LessonProgressStatus,
  modules,
  purchases,
  refundRequests,
  RefundRequestStatus,
  users,
  videoWatchEvents,
} from "~/db/schema";
import {
  checkRefundEligibility,
  judgeRefundRequest,
  type RefundEligibility,
  type RefundIneligibleReason,
} from "~/lib/refund-requests";

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function hasRefundRequestWithStatus(
  purchaseId: number,
  status: RefundRequestStatus
) {
  return !!db
    .select({ id: refundRequests.id })
    .from(refundRequests)
    .where(
      and(
        eq(refundRequests.purchaseId, purchaseId),
        eq(refundRequests.status, status)
      )
    )
    .get();
}

// A student gets one refund, ever, across all courses (docs/adr/0003).
function studentHasHadRefund(userId: number) {
  return !!db
    .select({ id: refundRequests.id })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .where(
      and(
        eq(purchases.userId, userId),
        eq(refundRequests.status, RefundRequestStatus.Approved)
      )
    )
    .get();
}

function isClaimedTeamSeat(purchaseId: number) {
  return !!db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt))
    )
    .get();
}

function getCompletedLessonCount(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return result?.count ?? 0;
}

// The furthest point reached in each lesson, added up.
function getSecondsWatched(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  return db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all()
    .reduce((total, row) => total + row.furthest, 0);
}

export type PurchaseRefundEligibility = RefundEligibility & {
  purchase: typeof purchases.$inferSelect;
  /** A refund is always what the student actually paid. */
  amount: number;
  secondsWatched: number;
  completedLessonCount: number;
};

/**
 * The refund eligibility of a student's latest purchase of a course, or null
 * if they have not bought it.
 */
export function getRefundEligibility(
  userId: number,
  courseId: number
): PurchaseRefundEligibility | null {
  const purchase = getLatestPurchase(userId, courseId);
  if (!purchase) return null;

  const lessonIds = getLessonIdsForCourse(courseId);
  const secondsWatched = getSecondsWatched(userId, lessonIds);
  const completedLessonCount = getCompletedLessonCount(userId, lessonIds);

  const eligibility = checkRefundEligibility({
    purchasedAt: purchase.createdAt,
    now: new Date(),
    secondsWatched,
    completedLessonCount,
    lessonCount: lessonIds.length,
    isClaimedTeamSeat: isClaimedTeamSeat(purchase.id),
    hasRequestedRefundRequest: hasRefundRequestWithStatus(
      purchase.id,
      RefundRequestStatus.Requested
    ),
    hasDeclinedRefundRequest: hasRefundRequestWithStatus(
      purchase.id,
      RefundRequestStatus.Declined
    ),
    studentHasHadRefund: studentHasHadRefund(userId),
  });

  return {
    ...eligibility,
    purchase,
    amount: purchase.amountPaid,
    secondsWatched,
    completedLessonCount,
  };
}

/**
 * When the student was refunded for this course, or null if they never were.
 * Shown on the course page after a refund (docs/adr/0003).
 */
export function getRefundForCourse(
  userId: number,
  courseId: number
): { refundedAt: string } | null {
  const row = db
    .select({ refundedAt: refundRequests.resolvedAt })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        eq(refundRequests.status, RefundRequestStatus.Approved)
      )
    )
    .get();

  return row?.refundedAt ? { refundedAt: row.refundedAt } : null;
}

export type SendRefundRequestResult =
  | { sent: true; refundRequestId: number; amount: number }
  | { sent: false; reason: RefundIneligibleReason | "not-bought" };

/**
 * Sends a refund request on the student's latest purchase of a course, if that
 * purchase is eligible.
 */
export function sendRefundRequest(
  userId: number,
  courseId: number,
  reason: string
): SendRefundRequestResult {
  const eligibility = getRefundEligibility(userId, courseId);
  if (!eligibility) return { sent: false, reason: "not-bought" };
  if (!eligibility.eligible) {
    return { sent: false, reason: eligibility.reason };
  }

  const created = db
    .insert(refundRequests)
    .values({
      purchaseId: eligibility.purchase.id,
      status: RefundRequestStatus.Requested,
      reason,
      secondsWatchedAtRequest: eligibility.secondsWatched,
      completedLessonCountAtRequest: eligibility.completedLessonCount,
    })
    .returning({ id: refundRequests.id })
    .get();

  return {
    sent: true,
    refundRequestId: created.id,
    amount: eligibility.amount,
  };
}

// ─── Admin Review ───

/**
 * Every refund request still waiting for an admin, oldest first, with the
 * numbers the admin needs and a suggested verdict (docs/adr/0001, 0002).
 */
export function getRequestedRefundRequests() {
  const rows = db
    .select({
      id: refundRequests.id,
      reason: refundRequests.reason,
      requestedAt: refundRequests.requestedAt,
      secondsWatchedAtRequest: refundRequests.secondsWatchedAtRequest,
      completedLessonCountAtRequest:
        refundRequests.completedLessonCountAtRequest,
      purchaseId: purchases.id,
      purchasedAt: purchases.createdAt,
      amount: purchases.amountPaid,
      studentId: users.id,
      studentName: users.name,
      studentEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(refundRequests.status, RefundRequestStatus.Requested))
    .orderBy(refundRequests.requestedAt)
    .all();

  return rows.map(
    ({ secondsWatchedAtRequest, completedLessonCountAtRequest, ...row }) => {
      const lessonIds = getLessonIdsForCourse(row.courseId);
      const now = {
        secondsWatched: getSecondsWatched(row.studentId, lessonIds),
        completedLessonCount: getCompletedLessonCount(row.studentId, lessonIds),
      };
      const hasHadRefund = studentHasHadRefund(row.studentId);
      const verdict = judgeRefundRequest({
        purchasedAt: row.purchasedAt,
        requestedAt: row.requestedAt,
        secondsWatchedNow: now.secondsWatched,
        completedLessonCountNow: now.completedLessonCount,
        lessonCount: lessonIds.length,
        isClaimedTeamSeat: isClaimedTeamSeat(row.purchaseId),
        studentHasHadRefund: hasHadRefund,
      });
      return {
        ...row,
        studentHasHadRefund: hasHadRefund,
        lessonCount: lessonIds.length,
        whenRequested: {
          secondsWatched: secondsWatchedAtRequest,
          completedLessonCount: completedLessonCountAtRequest,
        },
        now,
        verdict,
      };
    }
  );
}

const deciders = alias(users, "deciders");

/** The log of approved and declined refund requests, newest decision first. */
export function getDecidedRefundRequests() {
  return db
    .select({
      id: refundRequests.id,
      studentName: users.name,
      courseTitle: courses.title,
      requestedAt: refundRequests.requestedAt,
      status: refundRequests.status,
      decidedAt: refundRequests.resolvedAt,
      adminName: deciders.name,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .leftJoin(deciders, eq(refundRequests.resolvedByUserId, deciders.id))
    .where(ne(refundRequests.status, RefundRequestStatus.Requested))
    .orderBy(desc(refundRequests.resolvedAt))
    .all();
}

export type RefundDecision =
  RefundRequestStatus.Approved | RefundRequestStatus.Declined;

/**
 * Records an admin's decision on a refund request. Approving gives back what
 * the student paid and ends their access to the course for good. Only a
 * request in the requested status can be decided; an approved one is final.
 *
 * Returns false when the request does not exist or was already decided.
 */
export function decideRefundRequest(
  refundRequestId: number,
  decision: RefundDecision,
  adminUserId: number
): boolean {
  return db.transaction((tx) => {
    const request = tx
      .select({
        status: refundRequests.status,
        studentId: purchases.userId,
        courseId: purchases.courseId,
        amountPaid: purchases.amountPaid,
      })
      .from(refundRequests)
      .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
      .where(eq(refundRequests.id, refundRequestId))
      .get();

    if (!request || request.status !== RefundRequestStatus.Requested)
      return false;

    tx.update(refundRequests)
      .set({
        status: decision,
        amountRefunded:
          decision === RefundRequestStatus.Approved ? request.amountPaid : null,
        resolvedAt: new Date().toISOString(),
        resolvedByUserId: adminUserId,
      })
      .where(eq(refundRequests.id, refundRequestId))
      .run();

    if (decision === RefundRequestStatus.Approved) {
      tx.delete(enrollments)
        .where(
          and(
            eq(enrollments.userId, request.studentId),
            eq(enrollments.courseId, request.courseId)
          )
        )
        .run();
    }

    return true;
  });
}
