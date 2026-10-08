import { and, eq, exists, inArray } from "drizzle-orm"
import type { H3Event } from "h3"
import { db } from "vite-hub/database/drizzle"
import { useServerEnv } from "#vitehub/env/server"
import { abuseReports, user } from "../databases/config"
import { needsShareReview, reportTarget } from "../../shared/trust"

export async function shareReviewFor(ownerId: string, event?: H3Event, joinedOwner?: typeof user.$inferSelect | null) {
  if (useServerEnv(event).drop.shareApproval !== "1") return null
  const owner = joinedOwner !== undefined ? joinedOwner : (await db.select().from(user).where(eq(user.id, ownerId)).limit(1))[0]
  return needsShareReview(true, owner as typeof owner & { plan?: string }) ? "pending" as const : null
}

/** Embed report quarantine in the code-image owner lookup. */
export function rawFileQuarantine(target: string) {
  return exists(db.select({ id: abuseReports.id }).from(abuseReports)
    .where(and(eq(abuseReports.target, reportTarget(target) ?? target), inArray(abuseReports.status, ["quarantined", "banned"]))))
}

/** Legacy uploads and expiring images have no drop row to quarantine. */
export async function rawFileQuarantined(target: string) {
  const [report] = await db.select({ id: abuseReports.id }).from(abuseReports)
    .where(and(eq(abuseReports.target, reportTarget(target) ?? target), inArray(abuseReports.status, ["quarantined", "banned"]))).limit(1)
  return Boolean(report)
}
