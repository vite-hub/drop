import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"

/** Pending reservations hold capacity; committed rows are the authoritative monthly write ledger. */
export const quotaReservations = sqliteTable("quota_reservations", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  month: text("month").notNull(),
  drops: integer("drops").notNull(),
  bytes: integer("bytes").notNull(),
  writes: integer("writes").notNull(),
  targetId: text("target_id"),
  committed: integer("committed", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(),
}, table => [
  index("quota_owner_pending_idx").on(table.ownerId, table.committed),
  index("quota_owner_month_idx").on(table.ownerId, table.month),
  uniqueIndex("quota_pending_target_idx").on(table.targetId).where(sql`${table.committed} = 0`),
])

/** Temporary code images still consume storage until the cleanup has deleted their blob. */
export const quotaBlobs = sqliteTable("quota_blobs", {
  blobKey: text("blob_key").primaryKey(),
  ownerId: text("owner_id").notNull(),
  size: integer("size").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("quota_blobs_owner_idx").on(table.ownerId)])
