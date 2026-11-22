import { and, eq } from "drizzle-orm";
import { db } from "~/db";
import { UserRole, courses, purchases, users } from "~/db/schema";
import { getSession } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";
import { checkPppAccess } from "~/lib/ppp";
import { isEnrolled } from "~/lib/enrollments.server";

export type Course = typeof courses.$inferSelect;

export type Blocked =
  | { reason: "signed-out" }
  | { reason: "not-enrolled" }
  | { reason: "course-not-found" }
  | { reason: "ppp-country"; purchaseCountry: string; currentCountry: string };

export type CourseAccess = {
  userId: number | null;
  isPlatformAdmin: boolean;
  /** The Instructor who owns the course, or any Platform Admin. */
  isCourseManager: boolean;
  /** Has an Enrollment. Progress is recorded only with an Enrollment. */
  isEnrolled: boolean;
  /** May read the course's lessons and comments. */
  canViewContent: boolean;
  blocked: Blocked | null;
  /** The course row, when the course exists. */
  course: Course | null;
};

export type SignedInUser = { id: number; role: UserRole };

const NO_ACCESS = {
  isPlatformAdmin: false,
  isCourseManager: false,
  isEnrolled: false,
  canViewContent: false,
};

/**
 * The session reader: the signed-in user's id from the session cookie, or
 * null. This is the only code in Cadence that reads it.
 */
async function readSessionUserId(request: Request): Promise<number | null> {
  const session = await getSession(request);
  const userId = session.get("userId");
  return typeof userId === "number" ? userId : null;
}

/**
 * The signed-in user, or null. A session that names a user with no row
 * counts as signed out.
 */
export async function findSignedInUser(
  request: Request
): Promise<SignedInUser | null> {
  const userId = await readSessionUserId(request);
  if (userId === null) return null;
  const user = db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return user ?? null;
}

function findCourse(courseId: number): Course | null {
  return db.select().from(courses).where(eq(courses.id, courseId)).get() ?? null;
}

function findPurchaseCountry(userId: number, courseId: number): string | null {
  const purchase = db
    .select({ country: purchases.country })
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .get();
  return purchase?.country ?? null;
}

export async function computeCourseAccess(
  request: Request,
  courseId: number
): Promise<CourseAccess> {
  const user = await findSignedInUser(request);
  const course = findCourse(courseId);

  if (!user) {
    return {
      userId: null,
      ...NO_ACCESS,
      blocked: { reason: "signed-out" },
      course,
    };
  }

  const isPlatformAdmin = user.role === UserRole.Admin;

  if (!course) {
    return {
      userId: user.id,
      ...NO_ACCESS,
      isPlatformAdmin,
      blocked: { reason: "course-not-found" },
      course: null,
    };
  }

  const isCourseManager = isPlatformAdmin || course.instructorId === user.id;
  const enrolled = isEnrolled(db, user.id, courseId);

  // PPP blocks only a Student with an Enrollment. A Course Manager is exempt
  // (ADR-0009).
  let blocked: Blocked | null = null;
  if (enrolled && !isCourseManager) {
    const ppp = checkPppAccess(
      course.price,
      course.pppEnabled,
      findPurchaseCountry(user.id, courseId),
      await resolveCountry(request)
    );
    if (ppp.blocked && ppp.purchaseCountry && ppp.blockedCountry) {
      blocked = {
        reason: "ppp-country",
        purchaseCountry: ppp.purchaseCountry,
        currentCountry: ppp.blockedCountry,
      };
    }
  }
  if (!enrolled && !isCourseManager) {
    blocked = { reason: "not-enrolled" };
  }

  return {
    userId: user.id,
    isPlatformAdmin,
    isCourseManager,
    isEnrolled: enrolled,
    canViewContent: isCourseManager || (enrolled && blocked === null),
    blocked,
    course,
  };
}
