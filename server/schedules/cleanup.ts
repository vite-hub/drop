import { lte } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { codeImages } from "../databases/config"
import { defineSchedule } from "vite-hub/schedule"
import { cleanupQuotaBlobs, cleanupQuotaReservations } from "../utils/quotas"

/** The hourly cleanup: expired reservations and code images, the Trash, unused OAuth clients, and the search index's backlog. */
export default defineSchedule({
  cron: "0 * * * *",
  async handler({ scheduledAt }) {
    // Each step runs even when another fails, so a storage hiccup doesn't hold back the Trash purge.
    const errors: unknown[] = []
    const steps: Array<() => Promise<unknown>> = [
      () => cleanupQuotaReservations(scheduledAt),
      // Code images expire through their quota_blobs row; their own rows go once the blobs are gone.
      async () => {
        await cleanupQuotaBlobs(scheduledAt)
        await db.delete(codeImages).where(lte(codeImages.expiresAt, scheduledAt.getTime()))
      },
      async () => (await import("../utils/drops")).deleteExpiredDrops(scheduledAt),
      async () => (await import("../utils/oauth-cleanup")).cleanupUnusedOAuthClients(scheduledAt),
      // Text docs published before search read their words, a batch an hour.
      async () => (await import("../utils/search")).indexMissingTexts(),
    ]
    for (const step of steps) await step().catch(error => errors.push(error))
    if (errors.length === 1) throw errors[0]
    if (errors.length) throw new AggregateError(errors, errors.map(error => (error instanceof Error ? error.message : String(error))).join("; "))
  },
})
