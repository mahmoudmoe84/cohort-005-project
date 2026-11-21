import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  isBookmarked,
  listBookmarks,
  toggleBookmark,
} from "./bookmarks.server";

type TestDb = ReturnType<typeof createTestDb>;

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

describe("toggling a Bookmark", () => {
  it("adds a Bookmark, then removes it", () => {
    expect(toggleBookmark(db, base.user.id, lessonId)).toBe(true);
    expect(isBookmarked(db, base.user.id, lessonId)).toBe(true);

    expect(toggleBookmark(db, base.user.id, lessonId)).toBe(false);
    expect(isBookmarked(db, base.user.id, lessonId)).toBe(false);
  });

  it("keeps one Bookmark per Student per Lesson", () => {
    toggleBookmark(db, base.user.id, lessonId);
    toggleBookmark(db, base.user.id, lessonId);
    toggleBookmark(db, base.user.id, lessonId);

    expect(db.select().from(schema.bookmarks).all()).toHaveLength(1);
  });

  it("leaves another Student's Bookmark alone", () => {
    toggleBookmark(db, base.instructor.id, lessonId);
    toggleBookmark(db, base.user.id, lessonId);
    toggleBookmark(db, base.user.id, lessonId);

    expect(isBookmarked(db, base.instructor.id, lessonId)).toBe(true);
  });
});

describe("listing Bookmarks", () => {
  it("lists only the Student's own, with the Lesson's course", () => {
    toggleBookmark(db, base.user.id, lessonId);
    toggleBookmark(db, base.instructor.id, lessonId);

    expect(listBookmarks(db, base.user.id)).toEqual([
      expect.objectContaining({
        lessonId,
        lessonTitle: "Lesson 1",
        moduleTitle: "Basics",
        courseTitle: base.course.title,
        courseSlug: base.course.slug,
      }),
    ]);
  });

  it("lists the newest Bookmark first", () => {
    const second = db
      .insert(schema.lessons)
      .values({ moduleId, title: "Lesson 2", position: 2 })
      .returning()
      .get().id;

    toggleBookmark(db, base.user.id, lessonId);
    toggleBookmark(db, base.user.id, second);

    expect(listBookmarks(db, base.user.id).map((b) => b.lessonId)).toEqual([
      second,
      lessonId,
    ]);
  });
});
