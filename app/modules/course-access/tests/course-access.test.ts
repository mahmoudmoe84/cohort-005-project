import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDb,
  seedBaseData,
  seedCourse,
  seedUser,
  type TestDb,
} from "~/test/setup";
import { UserRole } from "~/db/schema";
import { setCurrentUserId } from "~/lib/session";
import { enrollStudentInTransaction } from "~/lib/enrollments.server";
import { createPurchase } from "~/lib/purchases.server";

let testDb: TestDb;
vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  getCourseAccess,
  getSignedInUserId,
  requireContentAccess,
  requireCourseManager,
  requireInstructor,
  requirePlatformAdmin,
  requireSignedIn,
} from "../index.server";

/** A real Request: a session cookie for the user, and a CF-IPCountry header. */
async function requestAs(
  userId: number | null,
  country: string | null = null
): Promise<Request> {
  const headers = new Headers();
  if (userId !== null) {
    const setCookie = await setCurrentUserId(
      new Request("http://localhost/"),
      userId
    );
    headers.set("Cookie", setCookie.split(";")[0]);
  }
  if (country) headers.set("CF-IPCountry", country);
  return new Request("http://localhost/", { headers });
}

let base: ReturnType<typeof seedBaseData>;

let nextUser = 0;
function addUser(role: UserRole) {
  nextUser += 1;
  return seedUser(testDb, role, nextUser);
}

/** A paid course with PPP turned on, owned by the base Instructor. */
function paidPppCourse() {
  return seedCourse(testDb, {
    slug: "paid-course",
    instructorId: base.instructor.id,
    categoryId: base.category.id,
    price: 10000,
    pppEnabled: true,
  });
}

/** A Purchase from a country, and the Enrollment it gives. */
function buy(userId: number, courseId: number, country: string) {
  createPurchase(testDb, userId, courseId, 5000, country);
  enrollStudentInTransaction(testDb, userId, courseId, new Date());
}

beforeEach(() => {
  testDb = createTestDb();
  base = seedBaseData(testDb);
});

describe("getCourseAccess", () => {
  it("gives signed-out for no session, and for a session whose user does not exist", async () => {
    for (const request of [await requestAs(null), await requestAs(9999)]) {
      const access = await getCourseAccess(request, base.course.id);
      expect(access.userId).toBeNull();
      expect(access.canViewContent).toBe(false);
      expect(access.blocked).toEqual({ reason: "signed-out" });
    }
  });

  it("gives not-enrolled and no content to a Student with no Enrollment", async () => {
    const access = await getCourseAccess(
      await requestAs(base.user.id),
      base.course.id
    );
    expect(access.userId).toBe(base.user.id);
    expect(access.isEnrolled).toBe(false);
    expect(access.canViewContent).toBe(false);
    expect(access.blocked).toEqual({ reason: "not-enrolled" });
  });

  it("lets a Student with a full-price Purchase read from another country", async () => {
    const course = paidPppCourse();
    buy(base.user.id, course.id, "US");
    const access = await getCourseAccess(
      await requestAs(base.user.id, "IN"),
      course.id
    );
    expect(access.isEnrolled).toBe(true);
    expect(access.canViewContent).toBe(true);
    expect(access.blocked).toBeNull();
  });

  it("blocks a discounted Purchase opened from another country, with both countries", async () => {
    const course = paidPppCourse();
    buy(base.user.id, course.id, "IN");
    const access = await getCourseAccess(
      await requestAs(base.user.id, "BR"),
      course.id
    );
    expect(access.isEnrolled).toBe(true);
    expect(access.canViewContent).toBe(false);
    expect(access.blocked).toEqual({
      reason: "ppp-country",
      purchaseCountry: "IN",
      currentCountry: "BR",
    });
  });

  it("does not block a discounted Purchase when the current country is unknown (ADR-0012)", async () => {
    const course = paidPppCourse();
    buy(base.user.id, course.id, "IN");
    const access = await getCourseAccess(
      await requestAs(base.user.id),
      course.id
    );
    expect(access.canViewContent).toBe(true);
    expect(access.blocked).toBeNull();
  });

  it("makes the owning Instructor a Course Manager who can read with no Enrollment", async () => {
    const access = await getCourseAccess(
      await requestAs(base.instructor.id),
      base.course.id
    );
    expect(access.isCourseManager).toBe(true);
    expect(access.isPlatformAdmin).toBe(false);
    expect(access.canViewContent).toBe(true);
    expect(access.isEnrolled).toBe(false);
    expect(access.blocked).toBeNull();
    expect(access.course?.id).toBe(base.course.id);
  });

  it("makes a Platform Admin abroad a Course Manager with no PPP block (ADR-0009)", async () => {
    const course = paidPppCourse();
    const admin = addUser(UserRole.Admin);
    buy(admin.id, course.id, "IN");
    const access = await getCourseAccess(
      await requestAs(admin.id, "BR"),
      course.id
    );
    expect(access.isPlatformAdmin).toBe(true);
    expect(access.isCourseManager).toBe(true);
    expect(access.canViewContent).toBe(true);
    expect(access.blocked).toBeNull();
  });

  it("does not make another course's Instructor a Course Manager", async () => {
    const other = addUser(UserRole.Instructor);
    const access = await getCourseAccess(
      await requestAs(other.id),
      base.course.id
    );
    expect(access.isCourseManager).toBe(false);
    expect(access.canViewContent).toBe(false);
    expect(access.blocked).toEqual({ reason: "not-enrolled" });
  });

  it("gives signed-out, not course-not-found, to a signed-out visitor on an unknown course", async () => {
    const access = await getCourseAccess(await requestAs(null), 9999);
    expect(access.course).toBeNull();
    expect(access.blocked).toEqual({ reason: "signed-out" });
  });

  it("gives course-not-found for an unknown course", async () => {
    const access = await getCourseAccess(await requestAs(base.user.id), 9999);
    expect(access.canViewContent).toBe(false);
    expect(access.course).toBeNull();
    expect(access.blocked).toEqual({ reason: "course-not-found" });
  });
});

/** The status and text a door function throws, as a route would send them. */
async function thrown(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isDataWithResponseInit(error)) {
      return { status: error.init?.status, text: error.data };
    }
    throw error;
  }
  throw new Error("expected the call to throw");
}

function isDataWithResponseInit(
  error: unknown
): error is { data: unknown; init: ResponseInit | null } {
  return typeof error === "object" && error !== null && "data" in error;
}

const SIGNED_OUT_401 = {
  status: 401,
  text: "Select a user from the DevUI panel.",
};

describe("getSignedInUserId and requireSignedIn", () => {
  it("gives the user id when signed in", async () => {
    const request = await requestAs(base.user.id);
    expect(await getSignedInUserId(request)).toBe(base.user.id);
    expect(await requireSignedIn(request)).toBe(base.user.id);
  });

  it("treats no session and an unknown user as signed out", async () => {
    for (const request of [await requestAs(null), await requestAs(9999)]) {
      expect(await getSignedInUserId(request)).toBeNull();
      expect(await thrown(requireSignedIn(request))).toEqual(SIGNED_OUT_401);
    }
  });
});

describe("requireContentAccess", () => {
  it("gives 401 when signed out", async () => {
    expect(
      await thrown(requireContentAccess(await requestAs(null), base.course.id))
    ).toEqual(SIGNED_OUT_401);
  });

  it("gives 404 for an unknown course", async () => {
    expect(
      await thrown(requireContentAccess(await requestAs(base.user.id), 9999))
    ).toEqual({ status: 404, text: "Course not found" });
  });

  // Regression for the lesson hole: the lesson action let these people
  // change progress and quiz results.
  it("refuses a Student with no Enrollment with 403", async () => {
    expect(
      await thrown(
        requireContentAccess(await requestAs(base.user.id), base.course.id)
      )
    ).toEqual({ status: 403, text: "You must be enrolled in this course." });
  });

  it("refuses a PPP-blocked Student with 403", async () => {
    const course = paidPppCourse();
    buy(base.user.id, course.id, "IN");
    expect(
      await thrown(
        requireContentAccess(await requestAs(base.user.id, "BR"), course.id)
      )
    ).toEqual({
      status: 403,
      text: "Your Purchase plays only in the country where you bought it (IN).",
    });
  });

  it("returns the access for a Student who can read", async () => {
    const course = paidPppCourse();
    buy(base.user.id, course.id, "IN");
    const access = await requireContentAccess(
      await requestAs(base.user.id, "IN"),
      course.id
    );
    expect(access.canViewContent).toBe(true);
    expect(access.course?.id).toBe(course.id);
  });
});

describe("requireCourseManager", () => {
  it("gives 401 when signed out and 404 for an unknown course", async () => {
    expect(
      await thrown(requireCourseManager(await requestAs(null), base.course.id))
    ).toEqual(SIGNED_OUT_401);
    expect(
      await thrown(
        requireCourseManager(await requestAs(base.instructor.id), 9999)
      )
    ).toEqual({ status: 404, text: "Course not found" });
  });

  it("refuses a Student and another course's Instructor with 403", async () => {
    const other = addUser(UserRole.Instructor);
    for (const userId of [base.user.id, other.id]) {
      expect(
        await thrown(
          requireCourseManager(await requestAs(userId), base.course.id)
        )
      ).toEqual({
        status: 403,
        text: "Only this course's instructor can do that.",
      });
    }
  });

  it("lets in the owning Instructor and a Platform Admin", async () => {
    const admin = addUser(UserRole.Admin);
    for (const userId of [base.instructor.id, admin.id]) {
      const access = await requireCourseManager(
        await requestAs(userId),
        base.course.id
      );
      expect(access.isCourseManager).toBe(true);
    }
  });
});

describe("requireInstructor", () => {
  it("gives 401 when signed out and 403 to a Student", async () => {
    expect(await thrown(requireInstructor(await requestAs(null)))).toEqual(
      SIGNED_OUT_401
    );
    expect(
      await thrown(requireInstructor(await requestAs(base.user.id)))
    ).toEqual({ status: 403, text: "Only instructors can access this page." });
  });

  it("lets in an Instructor and a Platform Admin", async () => {
    const admin = addUser(UserRole.Admin);
    expect(await requireInstructor(await requestAs(base.instructor.id))).toEqual(
      { userId: base.instructor.id, isPlatformAdmin: false }
    );
    expect(await requireInstructor(await requestAs(admin.id))).toEqual({
      userId: admin.id,
      isPlatformAdmin: true,
    });
  });
});

describe("requirePlatformAdmin", () => {
  it("gives 401 when signed out and 403 to a Student or an Instructor", async () => {
    expect(await thrown(requirePlatformAdmin(await requestAs(null)))).toEqual(
      SIGNED_OUT_401
    );
    for (const userId of [base.user.id, base.instructor.id]) {
      expect(
        await thrown(requirePlatformAdmin(await requestAs(userId)))
      ).toEqual({
        status: 403,
        text: "Only a Platform Admin can access this page.",
      });
    }
  });

  it("lets in a Platform Admin", async () => {
    const admin = addUser(UserRole.Admin);
    expect(await requirePlatformAdmin(await requestAs(admin.id))).toBe(
      admin.id
    );
  });
});
