// Course Access: the one door for every access question in Cadence.
// A route says what it needs; the module reads the session, the user, the
// course, the Enrollment and the PPP country check behind this door.

import { data } from "react-router";
import { UserRole } from "~/db/schema";
import {
  computeCourseAccess,
  findSignedInUser,
  type CourseAccess,
} from "./lib/access";

export type { CourseAccess } from "./lib/access";

/** Course access for a signed-in user on a course that exists. */
export type SignedInCourseAccess = CourseAccess & {
  userId: number;
  course: NonNullable<CourseAccess["course"]>;
};

const SIGNED_OUT_TEXT = "Select a user from the DevUI panel.";

function signedOut() {
  return data(SIGNED_OUT_TEXT, { status: 401 });
}

/**
 * The access of the signed-in user to a course. Never throws: the lesson page
 * uses it to show a paywall preview to visitors with no access.
 */
export function getCourseAccess(
  request: Request,
  courseId: number
): Promise<CourseAccess> {
  return computeCourseAccess(request, courseId);
}

/** The signed-in user's id, or null. Never throws. */
export async function getSignedInUserId(
  request: Request
): Promise<number | null> {
  const user = await findSignedInUser(request);
  return user?.id ?? null;
}

/** Throws 401 when signed out. Returns the user id. */
export async function requireSignedIn(request: Request): Promise<number> {
  const userId = await getSignedInUserId(request);
  if (userId === null) throw signedOut();
  return userId;
}

/** Throws 401 when signed out and 404 for an unknown course. */
async function requireCourse(
  request: Request,
  courseId: number
): Promise<SignedInCourseAccess> {
  const access = await computeCourseAccess(request, courseId);
  if (access.userId === null) throw signedOut();
  if (!access.course) throw data("Course not found", { status: 404 });
  return { ...access, userId: access.userId, course: access.course };
}

/**
 * Throws 401 when signed out, 404 for an unknown course, and 403 when the user
 * can't read the course's lessons and comments.
 */
export async function requireContentAccess(
  request: Request,
  courseId: number
): Promise<SignedInCourseAccess> {
  const access = await requireCourse(request, courseId);
  if (!access.canViewContent) {
    throw data("You must be enrolled in this course.", { status: 403 });
  }
  return access;
}

/**
 * Throws 401 when signed out, 404 for an unknown course, and 403 unless the
 * user is a Course Manager of the course.
 */
export async function requireCourseManager(
  request: Request,
  courseId: number
): Promise<SignedInCourseAccess> {
  const access = await requireCourse(request, courseId);
  if (!access.isCourseManager) {
    throw data("Only this course's instructor can do that.", { status: 403 });
  }
  return access;
}

/**
 * Throws 401 when signed out, and 403 unless the user is an Instructor or a
 * Platform Admin. For pages that span all of someone's courses.
 */
export async function requireInstructor(
  request: Request
): Promise<{ userId: number; isPlatformAdmin: boolean }> {
  const user = await findSignedInUser(request);
  if (!user) throw signedOut();
  if (user.role !== UserRole.Instructor && user.role !== UserRole.Admin) {
    throw data("Only instructors can access this page.", { status: 403 });
  }
  return { userId: user.id, isPlatformAdmin: user.role === UserRole.Admin };
}

/** Throws 401 when signed out, and 403 unless the user is a Platform Admin. */
export async function requirePlatformAdmin(request: Request): Promise<number> {
  const user = await findSignedInUser(request);
  if (!user) throw signedOut();
  if (user.role !== UserRole.Admin) {
    throw data("Only a Platform Admin can access this page.", { status: 403 });
  }
  return user.id;
}
