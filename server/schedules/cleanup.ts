import { defineSchedule } from "vite-hub/schedule"
import { background } from "../utils/logs"
import { cleanupCodeImages, cleanupQuotaReservations } from "../utils/quotas"

/**
 * The hourly cleanup's steps, by the name its run event gives each. A step returns what it did, as counts; `note` puts
 * something on its entry at once, so it stays there if the step fails later.
 */
const STEPS = {
  quotaReservations: cleanupQuotaReservations,
  codeImages: cleanupCodeImages,
  drops: async (at, note) =>
    (await import("../utils/drops")).deleteExpiredDrops(at, undefined, (deleted) => note({ deleted: [deleted] })),
  publicLinks: async (at) => (await import("../utils/share")).closePublicLinks(at),
  // MCP clients that registered over a day ago and never signed anyone in.
  mcpClients: async () => {
    const [error, result] = await (await import("vite-hub/auth/mcp")).deleteUnusedMcpClients()
    if (error) throw error
    return result
  },
  // Who viewed a drop is kept for the day only; the counts stay.
  viewers: async (at) => {
    await (await import("../utils/views")).forgetViewers(at)
    return {}
  },
  // Text docs published before search read their words, a batch an hour.
  searchIndex: async () => (await import("../utils/search")).indexMissingTexts(),
} satisfies Record<string, (scheduledAt: Date, note: (fields: Record<string, unknown>) => void) => Promise<object>>

/**
 * The hourly cleanup: expired reservations and code images, the Trash, closed public links, unused OAuth clients,
 * yesterday's viewers, and the search index's backlog.
 *
 * ViteHub's Schedule gives each run its own event, `schedule: { name, runId, scheduledAt, ms, outcome }`, with the
 * error this throws. Drop's event, `action: "cleanup"` with the same `runId`, adds what each step did, how long it
 * took, and which steps failed.
 */
export default defineSchedule({
  cron: "0 * * * *",
  async handler({ scheduledAt, runId }) {
    const run = background.logger({ action: "cleanup", ...(runId ? { runId } : {}) })
    // Each step runs even when another fails, so a storage hiccup doesn't hold back the Trash purge.
    const errors: unknown[] = []
    const failed: string[] = []
    for (const [name, step] of Object.entries(STEPS)) {
      const started = Date.now()
      // evlog appends to an array it already holds, so each `deleted` noted adds to the list.
      const note = (fields: Record<string, unknown>) => run.set({ steps: { [name]: fields } })
      try {
        run.set({ steps: { [name]: { ...(await step(scheduledAt, note)), ms: Date.now() - started } } })
      } catch (error) {
        errors.push(error)
        failed.push(name)
        const message = error instanceof Error ? error.message : String(error)
        run.set({ steps: { [name]: { error: message, ms: Date.now() - started } } })
      }
    }
    // The error and its stack are on ViteHub's run event, which logs what this throws.
    if (failed.length) run.warn("Cleanup steps failed", { failed })
    run.emit()
    if (errors.length === 1) throw errors[0]
    if (errors.length)
      throw new AggregateError(
        errors,
        errors.map((error) => (error instanceof Error ? error.message : String(error))).join("; "),
      )
  },
})
