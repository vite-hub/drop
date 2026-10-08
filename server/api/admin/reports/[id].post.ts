import { eq, inArray } from "drizzle-orm"
import { useLogger } from "evlog/nitro/v3"
import { defineValidatedHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { ReportActionSchema } from "#shared/schemas"
import { abuseReports, drops } from "../../../databases/config"
import { findDrop, versionChain } from "../../../utils/drops"
import { authFor, requireAdmin } from "../../../utils/identity"
import { routeId } from "../../../utils/params"
export default defineValidatedHandler({
  validate: { body: ReportActionSchema },
  async handler(event) {
    const who = await requireAdmin(event)
    const id = await routeId(event)
    const [report] = await db.select().from(abuseReports).where(eq(abuseReports.id, id)).limit(1)
    if (!report) throw new HTTPError({ status: 404, statusText: "No report with that id." })
    const { action } = await event.req.json()
    if (action === "ban") {
      if (!report.ownerId || report.ownerId === who.userId) throw new HTTPError({ status: 400, statusText: "This owner cannot be banned." })
      await authFor(event).api.banUser({ headers: event.req.headers, body: { userId: report.ownerId, banReason: "Abuse report" } })
      await db.update(drops).set({ quarantinedAt: Date.now() }).where(eq(drops.ownerId, report.ownerId))
    }
    if (action === "quarantine" && report.dropId) {
      const drop = await findDrop(report.dropId, event)
      if (drop) await db.update(drops).set({ quarantinedAt: Date.now() }).where(inArray(drops.id, (await versionChain(drop)).map(row => row.id)))
    }
    // Dismissing a report must never undo a quarantine.
    if (report.status === "quarantined" || report.status === "banned") {
      if (action === "dismiss") return { ok: true }
    }
    await db.update(abuseReports).set({ status: action === "dismiss" ? "dismissed" : action === "ban" ? "banned" : "quarantined", resolvedAt: Date.now(), resolvedBy: who.userId }).where(eq(abuseReports.id, id))
    useLogger(event).error("Abuse report action", { severity: "high", action: `abuse-${action}`, report: { id, dropId: report.dropId } })
    return { ok: true }
  },
})
