import { and, eq, exists, inArray } from "drizzle-orm"
import type { H3Event } from "h3"
import { db } from "vite-hub/database/drizzle"
import { useServerEnv } from "#vitehub/env/server"
import { abuseReports, user } from "../databases/config"
import { needsShareReview, reportTarget } from "#shared/trust"

export async function shareReviewFor(ownerId: string, event?: H3Event, joinedOwner?: typeof user.$inferSelect | null) {
  if (!useServerEnv(event).drop.shareApproval) return null
  const owner =
    joinedOwner !== undefined ? joinedOwner : (await db.select().from(user).where(eq(user.id, ownerId)).limit(1))[0]
  return needsShareReview(true, owner ?? undefined) ? ("pending" as const) : null
}

/** Code images have no drop row to quarantine, so their owner lookup checks for a report on the file itself. */
export function rawFileQuarantine(target: string) {
  return exists(
    db
      .select({ id: abuseReports.id })
      .from(abuseReports)
      .where(
        and(
          eq(abuseReports.target, reportTarget(target) ?? target),
          inArray(abuseReports.status, ["quarantined", "banned"]),
        ),
      ),
  )
}
