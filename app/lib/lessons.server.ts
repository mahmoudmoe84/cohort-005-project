import { and, eq, getTableColumns } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { lessons, modules } from "~/db/schema";

// The function takes the database first, so tests can give it an in-memory
// one. It uses positional parameters (project convention).

type Db = BetterSQLite3Database<typeof schema>;

/**
 * Finds the lesson only when it is in the course. A route checks access for
 * the course in its URL, so it must not act on a lesson of another course.
 */
export function findLessonInCourse(
  db: Db,
  lessonId: number,
  courseId: number
) {
  return db
    .select(getTableColumns(lessons))
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(and(eq(lessons.id, lessonId), eq(modules.courseId, courseId)))
    .get();
}
