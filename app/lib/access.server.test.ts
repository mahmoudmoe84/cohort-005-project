import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { setCurrentUserId, setDevCountry } from "~/lib/session";
import {
  getAccess,
  requireContentAccess,
  requireInstructorOrAdmin,
  requireStaff,
  requireUserId,
} from "./access.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

/** A request whose session cookie signs `userId` in, optionally from `country`. */
async function signedInRequest(userId: number, country?: string) {
  let cookie = cookieFrom(await setCurrentUserId(new Request("http://test/"), userId));
  if (country) {
    const withUser = new Request("http://test/", { headers: { Cookie: cookie } });
    cookie = cookieFrom(await setDevCountry(withUser, country));
  }
  return new Request("http://test/", { headers: { Cookie: cookie } });
}

function cookieFrom(setCookie: string) {
  return setCookie.split(";")[0];
}

const signedOut = () => new Request("http://test/");

/** The status of the response a guard threw, or "passed" if it didn't throw. */
async function statusOf(guard: Promise<unknown>) {
  try {
    await guard;
    return "passed";
  } catch (thrown) {
    return (thrown as { init?: { status?: number } }).init?.status;
  }
}

function insertUser(role: schema.UserRole, email: string) {
  return db
    .insert(schema.users)
    .values({ name: email, email, role })
    .returning()
    .get();
}

function enroll(userId: number) {
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
}

/** A paid, PPP-enabled course the Student bought at a discount from India. */
function buyAtDiscountFromIndia(userId: number) {
  db.update(schema.courses)
    .set({ price: 10000, pppEnabled: true })
    .run();
  db.insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid: 5000, country: "IN" })
    .run();
  enroll(userId);
}

describe("getAccess", () => {
  it("gives a signed-out visitor no access", async () => {
    const access = await getAccess(db, signedOut(), base.course.id);

    expect(access.userId).toBeNull();
    expect(access.canViewContent).toBe(false);
  });

  it("treats a session for a user who no longer exists as signed out", async () => {
    const access = await getAccess(db, await signedInRequest(999), base.course.id);

    expect(access.userId).toBeNull();
    expect(access.canViewContent).toBe(false);
  });

  it("keeps an unenrolled Student out of the content", async () => {
    const access = await getAccess(db, await signedInRequest(base.user.id), base.course.id);

    expect(access.userId).toBe(base.user.id);
    expect(access.enrolled).toBe(false);
    expect(access.isStaff).toBe(false);
    expect(access.canViewContent).toBe(false);
  });

  it("lets an enrolled Student read the content", async () => {
    enroll(base.user.id);

    const access = await getAccess(db, await signedInRequest(base.user.id), base.course.id);

    expect(access.enrolled).toBe(true);
    expect(access.canViewContent).toBe(true);
  });

  it("lets the owning instructor read the content without enrolling", async () => {
    const access = await getAccess(db, await signedInRequest(base.instructor.id), base.course.id);

    expect(access.isOwningInstructor).toBe(true);
    expect(access.isStaff).toBe(true);
    expect(access.canViewContent).toBe(true);
  });

  it("does not make another instructor staff on this course", async () => {
    const other = insertUser(schema.UserRole.Instructor, "other@example.com");

    const access = await getAccess(db, await signedInRequest(other.id), base.course.id);

    expect(access.isOwningInstructor).toBe(false);
    expect(access.isStaff).toBe(false);
    expect(access.canViewContent).toBe(false);
  });

  it("makes an admin staff on every course", async () => {
    const admin = insertUser(schema.UserRole.Admin, "admin@example.com");

    const access = await getAccess(db, await signedInRequest(admin.id), base.course.id);

    expect(access.isAdmin).toBe(true);
    expect(access.isOwningInstructor).toBe(false);
    expect(access.isStaff).toBe(true);
    expect(access.canViewContent).toBe(true);
  });

  it("blocks a Student who bought at a discount from viewing in another country", async () => {
    buyAtDiscountFromIndia(base.user.id);

    const access = await getAccess(db, await signedInRequest(base.user.id, "US"), base.course.id);

    expect(access.enrolled).toBe(true);
    expect(access.pppBlocked).toBe(true);
    expect(access.pppBlockedCountry).toBe("US");
    expect(access.pppPurchaseCountry).toBe("IN");
    expect(access.canViewContent).toBe(false);
  });

  it("lets that Student view from the country they bought in", async () => {
    buyAtDiscountFromIndia(base.user.id);

    const access = await getAccess(db, await signedInRequest(base.user.id, "IN"), base.course.id);

    expect(access.pppBlocked).toBe(false);
    expect(access.canViewContent).toBe(true);
  });

  it("never PPP-blocks staff, even when enrolled with a discounted purchase", async () => {
    const admin = insertUser(schema.UserRole.Admin, "admin@example.com");
    buyAtDiscountFromIndia(admin.id);

    const access = await getAccess(db, await signedInRequest(admin.id, "US"), base.course.id);

    expect(access.pppBlocked).toBe(false);
    expect(access.canViewContent).toBe(true);
  });
});

describe("requireUserId", () => {
  it("returns the signed-in user's id", async () => {
    expect(await requireUserId(await signedInRequest(base.user.id))).toBe(base.user.id);
  });

  it("throws 401 when signed out", async () => {
    expect(await statusOf(requireUserId(signedOut()))).toBe(401);
  });
});

describe("requireContentAccess", () => {
  it("throws 401 when signed out", async () => {
    expect(await statusOf(requireContentAccess(db, signedOut(), base.course.id))).toBe(401);
  });

  it("throws 403 for an unenrolled Student", async () => {
    const request = await signedInRequest(base.user.id);

    expect(await statusOf(requireContentAccess(db, request, base.course.id))).toBe(403);
  });

  it("throws 403 for a PPP-blocked Student", async () => {
    buyAtDiscountFromIndia(base.user.id);
    const request = await signedInRequest(base.user.id, "US");

    expect(await statusOf(requireContentAccess(db, request, base.course.id))).toBe(403);
  });

  it("returns the Access of an enrolled Student", async () => {
    enroll(base.user.id);
    const request = await signedInRequest(base.user.id);

    const access = await requireContentAccess(db, request, base.course.id);

    expect(access.userId).toBe(base.user.id);
  });
});

describe("requireStaff", () => {
  it("throws 401 when signed out", async () => {
    expect(await statusOf(requireStaff(db, signedOut(), base.course.id))).toBe(401);
  });

  it("throws 403 for an enrolled Student", async () => {
    enroll(base.user.id);
    const request = await signedInRequest(base.user.id);

    expect(await statusOf(requireStaff(db, request, base.course.id))).toBe(403);
  });

  it("throws 403 for an instructor who doesn't own the course", async () => {
    const other = insertUser(schema.UserRole.Instructor, "other@example.com");
    const request = await signedInRequest(other.id);

    expect(await statusOf(requireStaff(db, request, base.course.id))).toBe(403);
  });

  it("lets the owning instructor through", async () => {
    const request = await signedInRequest(base.instructor.id);

    expect(await statusOf(requireStaff(db, request, base.course.id))).toBe("passed");
  });
});

describe("requireInstructorOrAdmin", () => {
  it("throws 401 when signed out", async () => {
    expect(await statusOf(requireInstructorOrAdmin(db, signedOut()))).toBe(401);
  });

  it("throws 403 for a Student", async () => {
    const request = await signedInRequest(base.user.id);

    expect(await statusOf(requireInstructorOrAdmin(db, request))).toBe(403);
  });

  it("returns an instructor who isn't an admin", async () => {
    const result = await requireInstructorOrAdmin(db, await signedInRequest(base.instructor.id));

    expect(result.userId).toBe(base.instructor.id);
    expect(result.isAdmin).toBe(false);
  });

  it("returns an admin as an admin", async () => {
    const admin = insertUser(schema.UserRole.Admin, "admin@example.com");

    const result = await requireInstructorOrAdmin(db, await signedInRequest(admin.id));

    expect(result.isAdmin).toBe(true);
  });
});
