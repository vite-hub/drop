import { defineSchedule } from "vite-hub/schedule"
import { background } from "../utils/logs"
import { cleanupCodeImages, cleanupQuotaReservations } from "../utils/quotas"

const STEPS = {
  quotaReservations: cleanupQuotaReservations,
  codeImages: cleanupCodeImages,
  drops: async (at, note) =>
    (await import("../utils/drops")).deleteExpiredDrops(at, undefined, (deleted) => note({ deleted: [deleted] })),
  publicLinks: async (at) => (await import("../utils/share")).closePublicLinks(at),
  mcpClients: async () => {
    const [error, result] = await (await import("vite-hub/auth/mcp")).deleteUnusedMcpClients()
    if (error) throw error
    return result
  },
  viewers: async (at) => {
    await (await import("../utils/views")).forgetViewers(at)
    return {}
  },
  searchIndex: async () => (await import("../utils/search")).indexMissingTexts(),
} satisfies Record<string, (scheduledAt: Date, note: (fields: Record<string, unknown>) => void) => Promise<object>>

export default defineSchedule({
  cron: "0 * * * *",
  async handler({ scheduledAt, id, runId = id }) {
    const run = background.logger({
      action: "cleanup",
      scheduledAt: scheduledAt.toISOString(),
      ...(runId && { runId }),
    })
    const errors: unknown[] = []
    const failed: string[] = []
    for (const [name, step] of Object.entries(STEPS)) {
      const started = Date.now()
      const note = (fields: Record<string, unknown>) => run.set({ steps: { [name]: fields } })
      try {
        run.set({ steps: { [name]: { ...(await step(scheduledAt, note)), ms: Date.now() - started } } })
      } catch (error) {
        errors.push(error)
        failed.push(name)
        const message = error instanceof Error ? error.message : String(error)
        run.set({ steps: { [name]: { error: message, ms: Date.now() - started } } })
        run.error(error instanceof Error ? error : new Error(message))
      }
    }
    if (failed.length) run.set({ failed })
    run.emit()
    if (errors.length === 1) throw errors[0]
    if (errors.length)
      throw new AggregateError(
        errors,
        errors.map((error) => (error instanceof Error ? error.message : String(error))).join("; "),
      )
  },
})
