import { eq } from "drizzle-orm"
import { useLogger } from "evlog/nitro/v3"
import { defineValidatedHandler, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
import { requireRateLimit } from "vite-hub/rate-limit"
import { ReportSchema } from "#shared/schemas"
import { reportTarget } from "#shared/trust"
import { abuseReports, drops } from "../databases/config"

export default defineValidatedHandler({
  validate: { body: ReportSchema },
  async handler(event) {
    if (!import.meta.dev) await requireRateLimit(event, "abuse-report", { failure: "deny", limit: 5, window: "1m" })
    const body = await event.req.json()
    const target = reportTarget(body.target)
    if (!target) throw new HTTPError({ status: 400, statusText: "Use a Drop share or file link." })
    const [drop] = await db.select().from(drops).where(target.startsWith("/d/") ? eq(drops.id, target.slice(3)) : eq(drops.blobKey, decodeURIComponent(target.slice(3)))).limit(1)
    if (drop && drop.visibility !== "shared") throw new HTTPError({ status: 404, statusText: "No public drop with that link." })
    if (!drop) {
      if (decodeURIComponent(target.slice(3)).startsWith("apps/")) throw new HTTPError({ status: 404, statusText: "No public file with that link." })
      if (!target.startsWith("/f/")) throw new HTTPError({ status: 404, statusText: "No public drop with that link." })
      const [error, file] = await blob.get(decodeURIComponent(target.slice(3)))
      if (error?.code === "BLOB_NOT_FOUND") throw new HTTPError({ status: 404, statusText: "No public file with that link." })
      if (error) {
        useLogger(event).error(error, { action: "storage" })
        throw new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable." })
      }
      if (!file) throw new HTTPError({ status: 404, statusText: "No public file with that link." })
    }
    const id = crypto.randomUUID()
    await db.insert(abuseReports).values({ id, target, dropId: drop?.id, ownerId: drop?.ownerId, reason: body.reason, details: body.details, email: body.email || null, createdAt: Date.now() })
    // Always retained in Workers Logs, even when the request itself succeeded.
    useLogger(event).error("Abuse report received", { severity: "high", action: "abuse-report", report: { id, target, reason: body.reason } })
    return { ok: true }
  },
})
