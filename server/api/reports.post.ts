import { useLogger } from "evlog/nitro/v3"
import { defineValidatedHandler, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database"
import { requireRateLimit } from "vite-hub/rate-limit"
import { ReportSchema } from "#shared/schemas"
import { reportTarget } from "#shared/trust"
import { clientAddress } from "../utils/client-address"
import { abuseReports } from "../databases/default/index"
import { findDrop, findDropByBlob } from "../utils/drops"
import { logAudit } from "../utils/logs"

export default defineValidatedHandler({
  validate: { body: ReportSchema },
  async handler(event) {
    await requireRateLimit(event, "abuse-report", { key: clientAddress(event), limit: 5, window: "1m" })
    const body = await event.req.json()
    const target = reportTarget(body.target)
    if (!target) throw new HTTPError({ status: 400, statusText: "Use a Drop share or file link." })
    const drop = target.startsWith("/d/")
      ? await findDrop(target.slice(3))
      : await findDropByBlob(decodeURIComponent(target.slice(3)))
    if (drop && drop.share === "private")
      throw new HTTPError({ status: 404, statusText: "No public drop with that link." })
    if (!drop) {
      if (!target.startsWith("/f/")) throw new HTTPError({ status: 404, statusText: "No public drop with that link." })
      const key = decodeURIComponent(target.slice(3))
      if (key.startsWith("apps/")) throw new HTTPError({ status: 404, statusText: "No public file with that link." })
      const [error, file] = await blob.head(key)
      if (error?.code === "BLOB_NOT_FOUND")
        throw new HTTPError({ status: 404, statusText: "No public file with that link." })
      if (error) {
        useLogger(event).error(error, { action: "storage" })
        throw new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable." })
      }
      if (!file) throw new HTTPError({ status: 404, statusText: "No public file with that link." })
    }
    const id = crypto.randomUUID()
    await db.insert(abuseReports).values({
      id,
      target,
      dropId: drop?.id,
      ownerId: drop?.ownerId,
      reason: body.reason,
      details: body.details,
      email: body.email || null,
      createdAt: Date.now(),
    })
    logAudit(event, null, "report.create", { type: "report", id, target, reason: body.reason, drop: drop?.id })
    return { ok: true }
  },
})
