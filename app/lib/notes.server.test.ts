import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { getNote, listNotes, MAX_NOTE_LENGTH, saveNote } from "./notes.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 10, 21, 12, 0, 0);
const LATER = new Date(2026, 10, 21, 13, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let moduleId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  moduleId = module.id;

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;
});

describe("saving a Note", () => {
  it("stores the body trimmed", () => {
    expect(
      saveNote(db, base.user.id, lessonId, "  remember this  ", NOW)
    ).toEqual({ ok: true });
    expect(getNote(db, base.user.id, lessonId)).toEqual({
      body: "remember this",
      updatedAt: NOW.toISOString(),
    });
  });

  it("overwrites the one Note per Student per Lesson", () => {
    saveNote(db, base.user.id, lessonId, "first", NOW);
    saveNote(db, base.user.id, lessonId, "second", LATER);

    const rows = db.select().from(schema.notes).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      body: "second",
      createdAt: NOW.toISOString(),
      updatedAt: LATER.toISOString(),
    });
  });

  it("refuses an empty body and keeps the existing Note", () => {
    saveNote(db, base.user.id, lessonId, "first", NOW);

    expect(saveNote(db, base.user.id, lessonId, "   ", LATER).ok).toBe(false);
    expect(getNote(db, base.user.id, lessonId)).toEqual({
      body: "first",
      updatedAt: NOW.toISOString(),
    });
  });

  it("caps a Note at 2,000 characters", () => {
    expect(MAX_NOTE_LENGTH).toBe(2000);
  });

  it(`refuses a body over ${MAX_NOTE_LENGTH} characters`, () => {
    const result = saveNote(
      db,
      base.user.id,
      lessonId,
      "x".repeat(MAX_NOTE_LENGTH + 1),
      NOW
    );

    expect(result.ok).toBe(false);
    expect(getNote(db, base.user.id, lessonId)).toBeUndefined();
  });

  it("accepts a body of exactly the cap", () => {
    expect(
      saveNote(db, base.user.id, lessonId, "x".repeat(MAX_NOTE_LENGTH), NOW)
    ).toEqual({ ok: true });
  });
});

describe("listing Notes", () => {
  it("lists only the Student's own Notes", () => {
    saveNote(db, base.user.id, lessonId, "mine", NOW);
    saveNote(db, base.instructor.id, lessonId, "not mine", NOW);

    expect(listNotes(db, base.user.id)).toEqual([
      expect.objectContaining({
        body: "mine",
        lessonId,
        lessonTitle: "Lesson 1",
        moduleTitle: "Basics",
        courseTitle: base.course.title,
        courseSlug: base.course.slug,
      }),
    ]);
  });

  it("lists the most recently edited Note first", () => {
    const second = db
      .insert(schema.lessons)
      .values({ moduleId: moduleId, title: "Lesson 2", position: 2 })
      .returning()
      .get().id;

    saveNote(db, base.user.id, lessonId, "older", NOW);
    saveNote(db, base.user.id, second, "newer", LATER);
    expect(listNotes(db, base.user.id).map((n) => n.body)).toEqual([
      "newer",
      "older",
    ]);

    // Editing the older Note moves it back to the top.
    saveNote(db, base.user.id, lessonId, "older, edited", new Date(LATER.getTime() + 1));
    expect(listNotes(db, base.user.id).map((n) => n.body)).toEqual([
      "older, edited",
      "newer",
    ]);
  });
});
