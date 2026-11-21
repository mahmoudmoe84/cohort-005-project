import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { getLessonLocation, withLessonLocation } from "./student-lesson.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

function insertLesson(courseId: number, moduleTitle: string, title: string) {
  const module = db
    .insert(schema.modules)
    .values({ courseId, title: moduleTitle, position: 1 })
    .returning()
    .get();
  return db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title, position: 1 })
    .returning()
    .get().id;
}

function insertOtherCourse() {
  return db
    .insert(schema.courses)
    .values({
      title: "Other Course",
      slug: "other-course",
      description: "Another course",
      salesCopy: "Sales copy.",
      instructorId: base.instructor.id,
      categoryId: base.category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();
}

describe("getLessonLocation", () => {
  it("says which module and Course a Lesson sits in", () => {
    const lessonId = insertLesson(base.course.id, "Basics", "Lesson 1");

    expect(getLessonLocation(db, lessonId)).toEqual({
      lessonTitle: "Lesson 1",
      moduleTitle: "Basics",
      courseId: base.course.id,
      courseTitle: "Test Course",
      courseSlug: "test-course",
    });
  });

  it("reports the other Course for a Lesson that isn't in this one", () => {
    // The lesson route's 404 guard relies on this to refuse a Lesson id
    // from another Course.
    const other = insertOtherCourse();
    const lessonId = insertLesson(other.id, "Elsewhere", "Foreign lesson");

    expect(getLessonLocation(db, lessonId)?.courseId).toBe(other.id);
  });

  it("is undefined for a Lesson that doesn't exist", () => {
    expect(getLessonLocation(db, 999)).toBeUndefined();
  });
});

describe("withLessonLocation", () => {
  it("adds each row's location, keeping the rows' order", () => {
    const first = insertLesson(base.course.id, "Basics", "Lesson 1");
    const other = insertOtherCourse();
    const second = insertLesson(other.id, "Elsewhere", "Lesson 2");

    const rows = withLessonLocation(db, [
      { lessonId: second, tag: "a" },
      { lessonId: first, tag: "b" },
      { lessonId: second, tag: "c" },
    ]);

    expect(rows.map((r) => [r.tag, r.lessonTitle, r.courseSlug])).toEqual([
      ["a", "Lesson 2", "other-course"],
      ["b", "Lesson 1", "test-course"],
      ["c", "Lesson 2", "other-course"],
    ]);
  });

  it("drops a row whose Lesson has gone", () => {
    const lessonId = insertLesson(base.course.id, "Basics", "Lesson 1");

    const rows = withLessonLocation(db, [{ lessonId: 999 }, { lessonId }]);

    expect(rows.map((r) => r.lessonId)).toEqual([lessonId]);
  });

  it("returns nothing for no rows", () => {
    expect(withLessonLocation(db, [])).toEqual([]);
  });
});
