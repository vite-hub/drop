import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { user } from "./index"

/**
 * What Drop keeps about an account beyond Better Auth's own `user` columns, one row per account, written when the
 * account is made (server/auth.ts). Kept apart so `user` holds only the columns Better Auth defines.
 */
export const profile = sqliteTable("profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** Free or Pro (shared/quotas.ts TIERS), or null for DROP_DEFAULT_PLAN. */
  plan: text("plan", { enum: ["free", "pro", "unlimited"] }),
  /** When the GitHub account was made, in milliseconds: a review signal (shared/trust.ts). */
  githubCreatedAt: integer("github_created_at"),
})
