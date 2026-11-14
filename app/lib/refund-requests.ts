// ─── Refund Eligibility ───
// The rules for whether a purchase can still get a refund request. Like a
// warranty that runs out on years or mileage, eligibility ends as soon as any
// one limit is reached. See GLOSSARY.md.

export const REFUND_WINDOW_DAYS = 14;
export const REFUND_WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const REFUND_COMPLETION_LIMIT = 0.5;

export type RefundIneligibleReason =
  | "already-requested"
  | "already-refunded"
  | "declined"
  | "claimed-team-seat"
  | "window-passed"
  | "watched-too-much"
  | "completed-too-much";

export type RefundEligibilityInput = {
  /** ISO timestamp of the purchase. */
  purchasedAt: string;
  now: Date;
  secondsWatched: number;
  completedLessonCount: number;
  lessonCount: number;
  isClaimedTeamSeat: boolean;
  hasRequestedRefundRequest: boolean;
  /** Has the student had a refund on any course? A student gets one, ever. */
  studentHasHadRefund: boolean;
  /** Declined is final: a purchase never gets a second refund request. */
  hasDeclinedRefundRequest: boolean;
};

export type RefundEligibility =
  | { eligible: true; lastDayInWindow: string }
  | { eligible: false; reason: RefundIneligibleReason };

// The window is counted in whole calendar days, not hours — someone who buys
// at 23:00 still gets the whole of their fourteenth day.
export function toCalendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

export function lastDayOfRefundWindow(purchasedAt: string): string {
  const deadline = new Date(purchasedAt);
  deadline.setDate(deadline.getDate() + REFUND_WINDOW_DAYS);
  return toCalendarDay(deadline);
}

export function checkRefundEligibility(
  input: RefundEligibilityInput
): RefundEligibility {
  if (input.studentHasHadRefund) {
    return { eligible: false, reason: "already-refunded" };
  }

  if (input.hasDeclinedRefundRequest) {
    return { eligible: false, reason: "declined" };
  }

  if (input.hasRequestedRefundRequest) {
    return { eligible: false, reason: "already-requested" };
  }

  if (input.isClaimedTeamSeat) {
    return { eligible: false, reason: "claimed-team-seat" };
  }

  const purchasedDay = toCalendarDay(new Date(input.purchasedAt));
  const lastDayInWindow = lastDayOfRefundWindow(input.purchasedAt);
  const today = toCalendarDay(input.now);

  if (today < purchasedDay || today > lastDayInWindow) {
    return { eligible: false, reason: "window-passed" };
  }

  if (input.secondsWatched >= REFUND_WATCH_LIMIT_SECONDS) {
    return { eligible: false, reason: "watched-too-much" };
  }

  if (
    input.lessonCount > 0 &&
    input.completedLessonCount / input.lessonCount >= REFUND_COMPLETION_LIMIT
  ) {
    return { eligible: false, reason: "completed-too-much" };
  }

  return { eligible: true, lastDayInWindow };
}

/** What the student is told when a refund request is turned away. */
export const REFUND_INELIGIBLE_MESSAGES: Record<
  RefundIneligibleReason,
  string
> = {
  declined: "Your refund request for this purchase was declined.",
  "already-requested":
    "You already have a refund request waiting for review on this purchase.",
  "already-refunded": "You have already had a refund, and each student gets one.",
  "claimed-team-seat": "A claimed team seat cannot be refunded.",
  "window-passed": `The ${REFUND_WINDOW_DAYS}-day refund window has closed.`,
  "watched-too-much":
    "You have watched too much of this course to request a refund.",
  "completed-too-much":
    "You have completed too much of this course to request a refund.",
};

// ─── Suggested Verdict ───
// What the admin card suggests for a refund request in the requested status.
// It is only a suggestion; the admin decides (docs/adr/0002). The refund window
// is judged on the day the request was sent, so a slow review never costs the
// student; time watched and lessons completed are judged now, so watching after
// asking counts (docs/adr/0001).

export type JudgeRefundRequestInput = {
  /** ISO timestamp of the purchase. */
  purchasedAt: string;
  /** ISO timestamp of when the refund request was sent. */
  requestedAt: string;
  secondsWatchedNow: number;
  completedLessonCountNow: number;
  lessonCount: number;
  isClaimedTeamSeat: boolean;
  studentHasHadRefund: boolean;
};

export type RefundVerdict =
  | { eligible: true }
  | { eligible: false; reason: RefundIneligibleReason };

export function judgeRefundRequest(
  input: JudgeRefundRequestInput
): RefundVerdict {
  const result = checkRefundEligibility({
    purchasedAt: input.purchasedAt,
    now: new Date(input.requestedAt),
    secondsWatched: input.secondsWatchedNow,
    completedLessonCount: input.completedLessonCountNow,
    lessonCount: input.lessonCount,
    isClaimedTeamSeat: input.isClaimedTeamSeat,
    studentHasHadRefund: input.studentHasHadRefund,
    // This is the request being judged, so it does not count against itself.
    hasRequestedRefundRequest: false,
    hasDeclinedRefundRequest: false,
  });

  return result.eligible
    ? { eligible: true }
    : { eligible: false, reason: result.reason };
}
