import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db, resetTestDb } from "~/test/db";
import {
  categories,
  courses,
  CourseStatus,
  enrollments,
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
  purchases,
  RefundRequestStatus,
  UserRole,
  users,
  videoWatchEvents,
} from "~/db/schema";
import {
  decideRefundRequest,
  getRefundEligibility,
  getDecidedRefundRequests,
  getRefundForCourse,
  getRequestedRefundRequests,
  sendRefundRequest,
} from "./refund-requests.server";
import { isUserEnrolled } from "./access.server";

vi.mock("~/db", () => import("~/test/db"));

// ─── Arrange helpers ───
// These only set up the world. Every assertion goes through the public
// functions of refund-requests.server.ts.

let nextId = 1;

function createUser(role: UserRole) {
  const n = nextId++;
  return db
    .insert(users)
    .values({ name: `User ${n}`, email: `user${n}@example.com`, role })
    .returning()
    .get();
}

function createCourse(lessonCount = 10) {
  const n = nextId++;
  const instructor = createUser(UserRole.Instructor);
  const category = db
    .insert(categories)
    .values({ name: `Category ${n}`, slug: `category-${n}` })
    .returning()
    .get();
  const course = db
    .insert(courses)
    .values({
      title: `Course ${n}`,
      slug: `course-${n}`,
      description: "A course.",
      salesCopy: "Buy it.",
      instructorId: instructor.id,
      categoryId: category.id,
      status: CourseStatus.Published,
      price: 4900,
    })
    .returning()
    .get();
  const mod = db
    .insert(modules)
    .values({ courseId: course.id, title: "Module", position: 1 })
    .returning()
    .get();
  const lessonIds = Array.from(
    { length: lessonCount },
    (_, i) =>
      db
        .insert(lessons)
        .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
        .returning()
        .get().id
  );
  return { ...course, lessonIds };
}

function buyCourse(studentId: number, courseId: number, at: Date) {
  db.insert(enrollments)
    .values({ userId: studentId, courseId, enrolledAt: at.toISOString() })
    .run();
  return db
    .insert(purchases)
    .values({
      userId: studentId,
      courseId,
      amountPaid: 4900,
      createdAt: at.toISOString(),
    })
    .returning()
    .get();
}

/** The student reached this point in the lesson's video. */
function watch(studentId: number, lessonId: number, positionSeconds: number) {
  db.insert(videoWatchEvents)
    .values({ userId: studentId, lessonId, eventType: "progress", positionSeconds })
    .run();
}

function complete(studentId: number, lessonId: number) {
  db.insert(lessonProgress)
    .values({
      userId: studentId,
      lessonId,
      status: LessonProgressStatus.Completed,
      completedAt: new Date().toISOString(),
    })
    .run();
}

function setToday(when: Date) {
  vi.setSystemTime(when);
}

beforeEach(() => {
  resetTestDb();
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── Tests ───

describe("one refund per student, ever", () => {
  it("a student refunded on one course cannot send a refund request on another", () => {
    const admin = createUser(UserRole.Admin);
    const student = createUser(UserRole.Student);
    const courseX = createCourse();
    const courseY = createCourse();
    const bought = new Date(2026, 10, 1, 10, 0);
    buyCourse(student.id, courseX.id, bought);
    buyCourse(student.id, courseY.id, bought);

    setToday(new Date(2026, 10, 3, 10, 0));
    const sent = sendRefundRequest(student.id, courseX.id, "Not what I hoped for.");
    expect(sent.sent).toBe(true);
    if (!sent.sent) return;
    decideRefundRequest(sent.refundRequestId, RefundRequestStatus.Approved, admin.id);

    expect(getRefundEligibility(student.id, courseY.id)).toMatchObject({
      eligible: false,
      reason: "already-refunded",
    });
  });
});

describe("the admin card", () => {
  function studentWithPurchase() {
    const student = createUser(UserRole.Student);
    const course = createCourse();
    // Bought 1 Nov, so the last day in the refund window is 15 Nov.
    buyCourse(student.id, course.id, new Date(2026, 10, 1, 10, 0));
    return { student, course };
  }

  it("suggests eligible when sent on the last day and reviewed after the window passed", () => {
    const { student, course } = studentWithPurchase();
    setToday(new Date(2026, 10, 15, 22, 0));
    sendRefundRequest(student.id, course.id, "Not what I hoped for.");

    setToday(new Date(2026, 10, 17, 9, 0));
    const [card] = getRequestedRefundRequests();

    expect(card.verdict).toEqual({ eligible: true });
  });

  it("keeps the numbers from when the request was sent and shows what was watched since", () => {
    const { student, course } = studentWithPurchase();
    setToday(new Date(2026, 10, 3, 10, 0));
    watch(student.id, course.lessonIds[0], 30 * 60);
    sendRefundRequest(student.id, course.id, "Not what I hoped for.");

    watch(student.id, course.lessonIds[1], 3 * 60 * 60);
    setToday(new Date(2026, 10, 5, 10, 0));
    const [card] = getRequestedRefundRequests();

    expect(card.whenRequested).toEqual({ secondsWatched: 30 * 60, completedLessonCount: 0 });
    expect(card.now).toEqual({ secondsWatched: 3.5 * 60 * 60, completedLessonCount: 0 });
    expect(card.verdict).toEqual({ eligible: false, reason: "watched-too-much" });
  });
});

describe("approving a refund request", () => {
  it("removes access to the course but keeps the student's progress", () => {
    const admin = createUser(UserRole.Admin);
    const student = createUser(UserRole.Student);
    const course = createCourse();
    setToday(new Date(2026, 10, 3, 10, 0));
    buyCourse(student.id, course.id, new Date(2026, 10, 1, 10, 0));
    watch(student.id, course.lessonIds[0], 20 * 60);
    complete(student.id, course.lessonIds[0]);
    const sent = sendRefundRequest(student.id, course.id, "Not what I hoped for.");
    if (!sent.sent) throw new Error("expected the refund request to be sent");

    decideRefundRequest(sent.refundRequestId, RefundRequestStatus.Approved, admin.id);

    expect(isUserEnrolled(student.id, course.id)).toBe(false);
    expect(getRefundEligibility(student.id, course.id)).toMatchObject({
      secondsWatched: 20 * 60,
      completedLessonCount: 1,
    });
  });

  it("lets the student buy again, picking up their progress, but never refunds that purchase", () => {
    const admin = createUser(UserRole.Admin);
    const student = createUser(UserRole.Student);
    const course = createCourse();
    setToday(new Date(2026, 10, 3, 10, 0));
    buyCourse(student.id, course.id, new Date(2026, 10, 1, 10, 0));
    watch(student.id, course.lessonIds[0], 20 * 60);
    const sent = sendRefundRequest(student.id, course.id, "Not what I hoped for.");
    if (!sent.sent) throw new Error("expected the refund request to be sent");
    setToday(new Date(2026, 10, 4, 10, 0));
    decideRefundRequest(sent.refundRequestId, RefundRequestStatus.Approved, admin.id);

    setToday(new Date(2026, 10, 10, 10, 0));
    buyCourse(student.id, course.id, new Date(2026, 10, 10, 10, 0));

    expect(isUserEnrolled(student.id, course.id)).toBe(true);
    expect(getRefundEligibility(student.id, course.id)).toMatchObject({
      eligible: false,
      reason: "already-refunded",
      secondsWatched: 20 * 60,
    });
    expect(getRefundForCourse(student.id, course.id)).toEqual({
      refundedAt: new Date(2026, 10, 4, 10, 0).toISOString(),
    });
  });

  it("has no refund to show for a course the student was never refunded for", () => {
    const student = createUser(UserRole.Student);
    const course = createCourse();
    buyCourse(student.id, course.id, new Date(2026, 10, 1, 10, 0));

    expect(getRefundForCourse(student.id, course.id)).toBeNull();
  });
});

describe("deciding a refund request", () => {
  function sentRefundRequest() {
    const admin = createUser(UserRole.Admin);
    const student = createUser(UserRole.Student);
    const course = createCourse();
    setToday(new Date(2026, 10, 3, 10, 0));
    buyCourse(student.id, course.id, new Date(2026, 10, 1, 10, 0));
    const sent = sendRefundRequest(student.id, course.id, "Not what I hoped for.");
    if (!sent.sent) throw new Error("expected the refund request to be sent");
    return { admin, student, course, refundRequestId: sent.refundRequestId };
  }

  it("refuses a second decision on the same refund request", () => {
    const { admin, refundRequestId } = sentRefundRequest();

    expect(
      decideRefundRequest(refundRequestId, RefundRequestStatus.Approved, admin.id)
    ).toBe(true);
    expect(
      decideRefundRequest(refundRequestId, RefundRequestStatus.Approved, admin.id)
    ).toBe(false);
  });

  it("makes a declined purchase final: no second refund request", () => {
    const { admin, student, course, refundRequestId } = sentRefundRequest();
    decideRefundRequest(refundRequestId, RefundRequestStatus.Declined, admin.id);

    expect(isUserEnrolled(student.id, course.id)).toBe(true);
    expect(sendRefundRequest(student.id, course.id, "Please, one more time.")).toEqual({
      sent: false,
      reason: "declined",
    });
  });
});

describe("time watched", () => {
  it("counts the furthest point reached in a lesson, so rewatching does not add up", () => {
    const student = createUser(UserRole.Student);
    const course = createCourse();
    setToday(new Date(2026, 10, 3, 10, 0));
    buyCourse(student.id, course.id, new Date(2026, 10, 1, 10, 0));
    watch(student.id, course.lessonIds[0], 10 * 60);
    watch(student.id, course.lessonIds[0], 20 * 60);
    watch(student.id, course.lessonIds[0], 5 * 60);
    watch(student.id, course.lessonIds[1], 15 * 60);

    expect(getRefundEligibility(student.id, course.id)).toMatchObject({
      secondsWatched: 35 * 60,
    });
  });
});

describe("the decided log", () => {
  it("lists approved and declined refund requests, newest decision first, with who decided", () => {
    const admin = createUser(UserRole.Admin);
    const alice = createUser(UserRole.Student);
    const bob = createUser(UserRole.Student);
    const waiting = createUser(UserRole.Student);
    const course = createCourse();
    for (const student of [alice, bob, waiting]) {
      buyCourse(student.id, course.id, new Date(2026, 10, 1, 10, 0));
    }

    setToday(new Date(2026, 10, 2, 10, 0));
    const fromAlice = sendRefundRequest(alice.id, course.id, "Not what I hoped for.");
    const fromBob = sendRefundRequest(bob.id, course.id, "Too advanced for me.");
    sendRefundRequest(waiting.id, course.id, "Changed my mind.");
    if (!fromAlice.sent || !fromBob.sent) throw new Error("expected both to be sent");

    setToday(new Date(2026, 10, 3, 10, 0));
    decideRefundRequest(fromAlice.refundRequestId, RefundRequestStatus.Approved, admin.id);
    setToday(new Date(2026, 10, 4, 10, 0));
    decideRefundRequest(fromBob.refundRequestId, RefundRequestStatus.Declined, admin.id);

    expect(getDecidedRefundRequests()).toEqual([
      {
        id: fromBob.refundRequestId,
        studentName: bob.name,
        courseTitle: course.title,
        requestedAt: new Date(2026, 10, 2, 10, 0).toISOString(),
        status: RefundRequestStatus.Declined,
        decidedAt: new Date(2026, 10, 4, 10, 0).toISOString(),
        adminName: admin.name,
      },
      {
        id: fromAlice.refundRequestId,
        studentName: alice.name,
        courseTitle: course.title,
        requestedAt: new Date(2026, 10, 2, 10, 0).toISOString(),
        status: RefundRequestStatus.Approved,
        decidedAt: new Date(2026, 10, 3, 10, 0).toISOString(),
        adminName: admin.name,
      },
    ]);
  });
});
