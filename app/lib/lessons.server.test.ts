import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { findLessonInCourse } from "./lessons.server";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

// Each lesson gets a module of its own. These tests need only the course.
function addLesson(courseId: number, title: string, position: number) {
  const module = db
    .insert(schema.modules)
    .values({ courseId, title: "Basics", position: 1 })
    .returning()
    .get();

  return db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title, position })
    .returning()
    .get();
}

describe("findLessonInCourse", () => {
  it("finds nothing when no lesson has the id", () => {
    expect(findLessonInCourse(db, 999, base.course.id)).toBeUndefined();
  });

  it("finds a lesson of the course", () => {
    addLesson(base.course.id, "Union Types", 1);
    const generics = addLesson(base.course.id, "Generics", 2);

    expect(findLessonInCourse(db, generics.id, base.course.id)?.title).toBe(
      "Generics"
    );
  });

  it("finds nothing for a lesson of another course", () => {
    addLesson(base.course.id, "Union Types", 1);
    const otherCourse = db
      .insert(schema.courses)
      .values({
        title: "React Basics",
        slug: "react-basics",
        description: "Another course",
        salesCopy: "## React Basics",
        instructorId: base.instructor.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();
    const hooks = addLesson(otherCourse.id, "Hooks", 1);

    expect(findLessonInCourse(db, hooks.id, base.course.id)).toBeUndefined();
  });
});
