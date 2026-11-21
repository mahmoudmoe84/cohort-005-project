import { and, eq, inArray } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { courses, lessons, modules } from "~/db/schema";
import type { Db } from "~/lib/comments.server";

// ─── Per-Student, per-Lesson rows ───
// Shared plumbing for the things a Student keeps on a Lesson: Bookmarks and
// Notes. Both tables have a `userId` and a `lessonId`, one row per pair.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

type StudentLessonTable = { userId: SQLiteColumn; lessonId: SQLiteColumn };

/** The where-clause that picks the Student's one row on a Lesson. */
export function whereStudentOnLesson(
  table: StudentLessonTable,
  studentId: number,
  lessonId: number
) {
  return and(eq(table.userId, studentId), eq(table.lessonId, lessonId));
}

/** Where a Lesson sits: its module and Course. */
export type LessonLocation = {
  lessonTitle: string;
  moduleTitle: string;
  courseId: number;
  courseTitle: string;
  courseSlug: string;
};

function getLessonLocations(db: Db, lessonIds: number[]) {
  if (lessonIds.length === 0) return new Map<number, LessonLocation>();

  const rows = db
    .select({
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      moduleTitle: modules.title,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(inArray(lessons.id, [...new Set(lessonIds)]))
    .all();

  return new Map(rows.map(({ lessonId, ...location }) => [lessonId, location]));
}

/** Where one Lesson sits, or undefined when it does not exist. */
export function getLessonLocation(db: Db, lessonId: number) {
  return getLessonLocations(db, [lessonId]).get(lessonId);
}

/**
 * Adds each row's Lesson location in one query, keeping the rows' order. A
 * row whose Lesson has gone is dropped.
 */
export function withLessonLocation<Row extends { lessonId: number }>(
  db: Db,
  rows: Row[]
): (Row & LessonLocation)[] {
  const locations = getLessonLocations(
    db,
    rows.map((row) => row.lessonId)
  );
  return rows.flatMap((row) => {
    const location = locations.get(row.lessonId);
    return location ? [{ ...row, ...location }] : [];
  });
}
