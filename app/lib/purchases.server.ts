import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { purchases } from "~/db/schema";

export type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

/** Records a Purchase, and the country it was bought from when known. */
export function createPurchase(
  db: Queryable,
  userId: number,
  courseId: number,
  amountPaid: number,
  country: string | null
) {
  return db
    .insert(purchases)
    .values({ userId, courseId, amountPaid, country })
    .returning()
    .get();
}
