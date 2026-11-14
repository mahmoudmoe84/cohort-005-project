import { describe, it, expect } from "vitest";
import {
  checkRefundEligibility,
  judgeRefundRequest,
  lastDayOfRefundWindow,
  type JudgeRefundRequestInput,
  REFUND_WATCH_LIMIT_SECONDS,
  type RefundEligibilityInput,
} from "./refund-requests";

const purchasedAt = new Date(2026, 10, 1, 23, 0).toISOString();

function input(
  overrides: Partial<RefundEligibilityInput> = {}
): RefundEligibilityInput {
  return {
    purchasedAt,
    now: new Date(2026, 10, 3, 12, 0),
    secondsWatched: 0,
    completedLessonCount: 0,
    lessonCount: 10,
    isClaimedTeamSeat: false,
    hasRequestedRefundRequest: false,
    hasDeclinedRefundRequest: false,
    studentHasHadRefund: false,
    ...overrides,
  };
}

describe("checkRefundEligibility", () => {
  it("is eligible inside the window with little watched or completed", () => {
    expect(checkRefundEligibility(input())).toEqual({
      eligible: true,
      lastDayInWindow: "2026-11-15",
    });
  });

  it("stays eligible for the whole of the fourteenth day", () => {
    const result = checkRefundEligibility(
      input({ now: new Date(2026, 10, 15, 23, 59) })
    );
    expect(result.eligible).toBe(true);
  });

  it("ends once the refund window has passed", () => {
    expect(
      checkRefundEligibility(input({ now: new Date(2026, 10, 16, 0, 1) }))
    ).toEqual({ eligible: false, reason: "window-passed" });
  });

  it("ends once two hours have been watched, even inside the window", () => {
    expect(
      checkRefundEligibility(
        input({ secondsWatched: REFUND_WATCH_LIMIT_SECONDS })
      )
    ).toEqual({ eligible: false, reason: "watched-too-much" });
  });

  it("ends once half the lessons are completed, even inside the window", () => {
    expect(checkRefundEligibility(input({ completedLessonCount: 5 }))).toEqual({
      eligible: false,
      reason: "completed-too-much",
    });
  });

  it("ignores completion for a course with no lessons", () => {
    const result = checkRefundEligibility(
      input({ lessonCount: 0, completedLessonCount: 0 })
    );
    expect(result.eligible).toBe(true);
  });

  it("is never eligible for a claimed team seat", () => {
    expect(checkRefundEligibility(input({ isClaimedTeamSeat: true }))).toEqual({
      eligible: false,
      reason: "claimed-team-seat",
    });
  });

  it("allows only one refund request in the requested status", () => {
    expect(
      checkRefundEligibility(input({ hasRequestedRefundRequest: true }))
    ).toEqual({ eligible: false, reason: "already-requested" });
  });

  it("is never eligible again once a refund request on the purchase was declined", () => {
    expect(
      checkRefundEligibility(input({ hasDeclinedRefundRequest: true }))
    ).toEqual({ eligible: false, reason: "declined" });
  });

  it("is never eligible once the student has had a refund on any course", () => {
    expect(
      checkRefundEligibility(input({ studentHasHadRefund: true }))
    ).toEqual({ eligible: false, reason: "already-refunded" });
  });
});

// The suggested verdict on the admin card. The refund window is judged on the
// day the refund request was sent; time watched and lessons completed are
// judged now. See docs/adr/0001.
describe("judgeRefundRequest", () => {
  // Bought 1 Nov, so the last day in the window is 15 Nov.
  function request(
    overrides: Partial<JudgeRefundRequestInput> = {}
  ): JudgeRefundRequestInput {
    return {
      purchasedAt,
      requestedAt: new Date(2026, 10, 3, 12, 0).toISOString(),
      secondsWatchedNow: 0,
      completedLessonCountNow: 0,
      lessonCount: 10,
      isClaimedTeamSeat: false,
      studentHasHadRefund: false,
      ...overrides,
    };
  }

  it("stays eligible when sent on the last day and reviewed after the window passed", () => {
    expect(
      judgeRefundRequest(
        request({ requestedAt: new Date(2026, 10, 15, 22, 0).toISOString() })
      )
    ).toEqual({ eligible: true });
  });

  it("is not eligible when the student watched past two hours after asking", () => {
    expect(judgeRefundRequest(request({ secondsWatchedNow: 3 * 60 * 60 }))).toEqual(
      { eligible: false, reason: "watched-too-much" }
    );
  });

  it("is not eligible when finishing a lesson after asking goes just over two hours", () => {
    expect(
      judgeRefundRequest(request({ secondsWatchedNow: (2 * 60 + 5) * 60 }))
    ).toEqual({ eligible: false, reason: "watched-too-much" });
  });

  it("is eligible when reviewed the same day it was sent", () => {
    expect(
      judgeRefundRequest(
        request({
          requestedAt: new Date(2026, 10, 2, 9, 0).toISOString(),
          secondsWatchedNow: 30 * 60,
        })
      )
    ).toEqual({ eligible: true });
  });

  it("is not eligible when half the lessons were completed after asking", () => {
    expect(judgeRefundRequest(request({ completedLessonCountNow: 5 }))).toEqual({
      eligible: false,
      reason: "completed-too-much",
    });
  });

  it("is not eligible when the student was refunded on another course while it waited", () => {
    expect(judgeRefundRequest(request({ studentHasHadRefund: true }))).toEqual({
      eligible: false,
      reason: "already-refunded",
    });
  });
});

describe("lastDayOfRefundWindow", () => {
  it("is the purchase day plus fourteen calendar days", () => {
    expect(lastDayOfRefundWindow(purchasedAt)).toBe("2026-11-15");
  });
});
