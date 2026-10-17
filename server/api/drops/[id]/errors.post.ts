import { defineValidatedHandler } from "h3"
import * as v from "valibot"
import { requireRateLimit } from "vite-hub/rate-limit"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"
import { recordRuntimeErrors } from "../../../utils/runtime-errors"

const Report = v.object({
  kind: v.picklist(["error", "rejection", "console", "load"]),
  message: v.pipe(v.string(), v.minLength(1), v.maxLength(500)),
  source: v.optional(v.pipe(v.string(), v.maxLength(300))),
  page: v.optional(v.pipe(v.string(), v.maxLength(300))),
})

/**
 * The viewer forwards what an app or HTML page reported going wrong, so the agent that published it reads the
 * errors in read_drop. Anyone who can open the drop reports; the text comes from the page, so it's untrusted.
 */
export default defineValidatedHandler({
  validate: { body: v.object({ version: v.pipe(v.number(), v.integer()), errors: v.pipe(v.array(Report), v.minLength(1), v.maxLength(20)) }) },
  async handler(event) {
    const drop = await findDrop(await routeId(event), event)
    const who = await identify(event)
    event.res.status = 204
    if (!drop || (drop.kind !== "app" && drop.kind !== "html") || drop.expired || !permissions(drop, who).view) return null
    await requireRateLimit(event, "runtime-error", { key: `${drop.id}:${who?.userId ?? "guest"}`, limit: 10, window: "1m" })
    const { version, errors } = await event.req.json() as { version: number; errors: v.InferOutput<typeof Report>[] }
    if (version === drop.version) await recordRuntimeErrors(drop.id, version, errors)
    return null
  },
})
