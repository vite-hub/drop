import { sql, type SQLWrapper } from "drizzle-orm"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const isFileReport = (target: SQLWrapper) => sql`${target} glob '/f/*'`
export const normalizedFileTarget = (target: SQLWrapper) => sql`'/f/' || ltrim(substr(${target}, 4), '/')`

export const abuseReports = sqliteTable(
  "abuse_reports",
  {
    id: text("id").primaryKey(),
    dropId: text("drop_id"),
    ownerId: text("owner_id"),
    target: text("target").notNull(),
    reason: text("reason").notNull(),
    details: text("details").notNull(),
    email: text("email"),
    status: text("status", { enum: ["open", "dismissed", "quarantined", "banned"] })
      .notNull()
      .default("open"),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
    resolvedBy: text("resolved_by"),
  },
  (table) => [
    index("abuse_reports_status_idx").on(table.status, table.createdAt),
    index("abuse_reports_target_idx").on(table.target),
    index("abuse_reports_file_target_idx")
      .on(normalizedFileTarget(sql.identifier(table.target.name)), table.status)
      .where(isFileReport(sql.identifier(table.target.name))),
  ],
)
