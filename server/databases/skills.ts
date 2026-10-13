import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * Deployment-wide switches for the built-in Agent Skills. A skill with no row is enabled, so new built-ins
 * ship on and a fresh database needs no seed. Only admins write here.
 */
export const skillSettings = sqliteTable("skill_settings", {
  name: text("name").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull(),
  updatedAt: integer("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
})
