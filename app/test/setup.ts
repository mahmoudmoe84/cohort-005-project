import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "~/db/schema";
import { markdown } from "~/lib/text";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsFolder = path.resolve(__dirname, "../../drizzle");

/**
 * Creates a fresh in-memory SQLite database with all tables for testing.
 * Each call returns a new isolated database instance.
 *
 * Uses the same Drizzle migrations as the live database, ensuring
 * test and production schemas are always in sync.
 */
export function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const testDb = drizzle(sqlite, { schema });

  migrate(testDb, { migrationsFolder });

  return testDb;
}

export type TestDb = ReturnType<typeof createTestDb>;

/**
 * Seeds a minimal set of base data (user, category, course) that most tests need.
 * Returns the created IDs for use in test assertions.
 */
export function seedBaseData(testDb: TestDb) {
  const user = testDb
    .insert(schema.users)
    .values({
      name: "Test User",
      email: "test@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get();

  const instructor = testDb
    .insert(schema.users)
    .values({
      name: "Test Instructor",
      email: "instructor@example.com",
      role: schema.UserRole.Instructor,
    })
    .returning()
    .get();

  const category = testDb
    .insert(schema.categories)
    .values({ name: "Programming", slug: "programming" })
    .returning()
    .get();

  const course = testDb
    .insert(schema.courses)
    .values({
      title: "Test Course",
      slug: "test-course",
      description: "A test course",
      salesCopy: markdown("## Test Course\n\nSales copy for the test course."),
      instructorId: instructor.id,
      categoryId: category.id,
      status: schema.CourseStatus.Published,
    })
    .returning()
    .get();

  return { user, instructor, category, course };
}

/** Seeds one more user with a role, for tests that need more than the base. */
export function seedUser(testDb: TestDb, role: schema.UserRole, n: number) {
  return testDb
    .insert(schema.users)
    .values({ name: `User ${n}`, email: `user${n}@example.com`, role })
    .returning()
    .get();
}

/** Seeds one more published course, with a price and PPP when given. */
export function seedCourse(
  testDb: TestDb,
  values: {
    slug: string;
    instructorId: number;
    categoryId: number;
    price?: number;
    pppEnabled?: boolean;
  }
) {
  return testDb
    .insert(schema.courses)
    .values({
      title: values.slug,
      description: `The ${values.slug} course`,
      salesCopy: markdown(`## ${values.slug}`),
      status: schema.CourseStatus.Published,
      ...values,
    })
    .returning()
    .get();
}
