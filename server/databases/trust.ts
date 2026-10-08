import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const abuseReports = sqliteTable("abuse_reports", {
  id: text("id").primaryKey(),
  // Keep the report after a drop or account is deleted.
  dropId: text("drop_id"),
  ownerId: text("owner_id"),
  target: text("target").notNull(),
  reason: text("reason").notNull(),
  details: text("details").notNull(),
  email: text("email"),
  status: text("status", { enum: ["open", "dismissed", "quarantined", "banned"] }).notNull().default("open"),
  createdAt: integer("created_at").notNull(),
  resolvedAt: integer("resolved_at"),
  resolvedBy: text("resolved_by"),
}, table => [index("abuse_reports_status_idx").on(table.status, table.createdAt), index("abuse_reports_target_idx").on(table.target)])
