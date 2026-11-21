import { desc, eq } from "drizzle-orm";
import { bookmarks } from "~/db/schema";
import type { Db } from "~/lib/comments.server";
import {
  whereStudentOnLesson,
  withLessonLocation,
} from "~/lib/student-lesson.server";

// ─── Bookmarks ───
// A Student's flag on a Lesson, one per Student per Lesson. Only the Student
// who made it ever reads it. See GLOSSARY.md and docs/adr/0013.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

export function isBookmarked(db: Db, studentId: number, lessonId: number) {
  return !!db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(whereStudentOnLesson(bookmarks, studentId, lessonId))
    .get();
}

/**
 * Adds the Bookmark if the Student has none on this Lesson, removes it if they
 * do. Returns whether the Lesson is bookmarked afterwards.
 */
export function toggleBookmark(db: Db, studentId: number, lessonId: number) {
  const removed = db
    .delete(bookmarks)
    .where(whereStudentOnLesson(bookmarks, studentId, lessonId))
    .returning({ id: bookmarks.id })
    .all();

  if (removed.length > 0) return false;

  // A concurrent toggle may have inserted first; the unique index makes this
  // a no-op rather than a crash.
  db.insert(bookmarks)
    .values({ userId: studentId, lessonId })
    .onConflictDoNothing()
    .run();
  return true;
}

/**
 * The Student's Bookmarks, newest first, each with where its Lesson sits so
 * the Saved page can link back to it.
 */
export function listBookmarks(db: Db, studentId: number) {
  const rows = db
    .select({
      id: bookmarks.id,
      lessonId: bookmarks.lessonId,
      createdAt: bookmarks.createdAt,
    })
    .from(bookmarks)
    .where(eq(bookmarks.userId, studentId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();
  return withLessonLocation(db, rows);
}
