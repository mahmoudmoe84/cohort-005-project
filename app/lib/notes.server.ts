import { desc, eq } from "drizzle-orm";
import { notes } from "~/db/schema";
import type { Db } from "~/lib/comments.server";
import {
  whereStudentOnLesson,
  withLessonLocation,
} from "~/lib/student-lesson.server";

// ─── Notes ───
// A Student's own writing about a Lesson, one per Student per Lesson, private
// to the Student who wrote it. Stored and shown as plain text. See GLOSSARY.md,
// docs/adr/0013 and docs/adr/0014.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

export const MAX_NOTE_LENGTH = 2000;

export function getNote(db: Db, studentId: number, lessonId: number) {
  return db
    .select({ body: notes.body, updatedAt: notes.updatedAt })
    .from(notes)
    .where(whereStudentOnLesson(notes, studentId, lessonId))
    .get();
}

export type SaveNoteResult = { ok: true } | { ok: false; error: string };

/**
 * Writes the Student's Note on a Lesson, trimmed. Saving again replaces the
 * body and moves `updatedAt` on; `createdAt` stays put.
 */
export function saveNote(
  db: Db,
  studentId: number,
  lessonId: number,
  body: string,
  now: Date
): SaveNoteResult {
  const trimmed = body.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `A note can be at most ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters.`,
    };
  }

  if (trimmed.length === 0) {
    return { ok: false, error: "Write something before saving your note." };
  }

  const timestamp = now.toISOString();
  db.insert(notes)
    .values({
      userId: studentId,
      lessonId,
      body: trimmed,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: trimmed, updatedAt: timestamp },
    })
    .run();
  return { ok: true };
}

/**
 * The Student's Notes, most recently edited first, each with where its Lesson
 * sits so the Saved page can link back to it.
 */
export function listNotes(db: Db, studentId: number) {
  const rows = db
    .select({
      id: notes.id,
      lessonId: notes.lessonId,
      body: notes.body,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(eq(notes.userId, studentId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
  return withLessonLocation(db, rows);
}
