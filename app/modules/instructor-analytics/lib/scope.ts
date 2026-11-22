import { and, eq, gte } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { courses, purchases } from "~/db/schema";
import { rangeStart, type AnalyticsRange } from "../config";

// The WHERE fragments every panel shares, so "this instructor" and "this
// range" mean the same thing in every query. A null instructor is
// platform-wide; the range boundary itself is decided by `rangeStart`.

export function scopeOn(
  dateColumn: SQLiteColumn,
  instructorId: number | null,
  range: AnalyticsRange
) {
  const conditions = [];

  if (instructorId !== null) {
    conditions.push(eq(courses.instructorId, instructorId));
  }

  const start = rangeStart(range);
  if (start !== null) {
    conditions.push(gte(dateColumn, start));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export function purchaseScope(
  instructorId: number | null,
  range: AnalyticsRange
) {
  return scopeOn(purchases.createdAt, instructorId, range);
}

export function sinceRange(dateColumn: SQLiteColumn, range: AnalyticsRange) {
  const start = rangeStart(range);
  return start === null ? undefined : gte(dateColumn, start);
}

export function ownedBy(instructorId: number | null) {
  return instructorId === null
    ? undefined
    : eq(courses.instructorId, instructorId);
}
