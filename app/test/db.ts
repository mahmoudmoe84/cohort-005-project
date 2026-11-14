// A stand-in for `~/db` in tests: an in-memory SQLite database built from the
// real migrations, so queries run against the real schema without touching
// data.db. Use it with:
//
//   vi.mock("~/db", () => import("~/test/db"));
//
// and call `resetTestDb()` in `beforeEach` to start every test empty.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "~/db/schema";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle" });
  return { sqlite, db };
}

let current = createTestDb();

export function resetTestDb() {
  current.sqlite.close();
  current = createTestDb();
}

export function getSqlite() {
  return current.sqlite;
}

export const db = new Proxy({} as typeof current.db, {
  get(_target, prop) {
    const value = Reflect.get(current.db, prop);
    return typeof value === "function" ? value.bind(current.db) : value;
  },
});
