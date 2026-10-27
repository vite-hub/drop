import { defineSchedule } from "vite-hub/schedule"
import { cleanupCodeImages, cleanupQuotaReservations } from "../utils/quotas"

/** The hourly cleanup: expired reservations and code images, the Trash, closed public links, unused OAuth clients, yesterday's viewers, and the search index's backlog. */
export default defineSchedule({
  cron: "0 * * * *",
  async handler({ scheduledAt }) {
    // Each step runs even when another fails, so a storage hiccup doesn't hold back the Trash purge.
    const errors: unknown[] = []
    const steps: Array<() => Promise<unknown>> = [
      () => cleanupQuotaReservations(scheduledAt),
      () => cleanupCodeImages(scheduledAt),
      async () => (await import("../utils/drops")).deleteExpiredDrops(scheduledAt),
      async () => (await import("../utils/share")).closePublicLinks(scheduledAt),
      async () => (await import("../utils/oauth-cleanup")).cleanupUnusedOAuthClients(scheduledAt),
      // Who viewed a drop is kept for the day only; the counts stay.
      async () => (await import("../utils/views")).forgetViewers(scheduledAt),
      // Text docs published before search read their words, a batch an hour.
      async () => (await import("../utils/search")).indexMissingTexts(),
    ]
    for (const step of steps) await step().catch((error) => errors.push(error))
    if (errors.length === 1) throw errors[0]
    if (errors.length)
      throw new AggregateError(
        errors,
        errors.map((error) => (error instanceof Error ? error.message : String(error))).join("; "),
      )
  },
})
