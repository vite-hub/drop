import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const uiUsage = sqliteTable(
  "ui_usage",
  {
    day: text("day").notNull(),
    release: text("release").notNull(),
    kind: text("kind").notNull(),
    mode: text("mode").notNull(),
    control: text("control").notNull(),
    via: text("via").notNull(),
    count: integer("count").notNull(),
  },
  (table) => [primaryKey({ columns: [table.day, table.release, table.kind, table.mode, table.control, table.via] })],
)
