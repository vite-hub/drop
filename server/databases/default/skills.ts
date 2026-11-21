import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const skillSettings = sqliteTable("skill_settings", {
  name: text("name").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by"),
})
