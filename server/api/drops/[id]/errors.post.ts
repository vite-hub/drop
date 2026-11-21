import { defineValidatedHandler, noContent } from "h3"
import * as v from "valibot"
import { RuntimeErrorSchema } from "#shared/schemas"
import { requireRateLimit } from "vite-hub/rate-limit"
import { findDrop, permissions } from "../../../utils/drops"
import { identify } from "../../../utils/identity"
import { routeId } from "../../../utils/params"
import { recordRuntimeErrors } from "../../../utils/runtime-errors"

export default defineValidatedHandler({
  validate: {
    body: v.object({
      version: v.pipe(v.number(), v.integer()),
      errors: v.pipe(v.array(RuntimeErrorSchema), v.minLength(1), v.maxLength(20)),
    }),
  },
  async handler(event) {
    const drop = await findDrop(await routeId(event), event)
    const who = await identify(event)
    if (!drop || (drop.kind !== "app" && drop.kind !== "html") || drop.expired || !permissions(drop, who).view)
      return noContent()
    await requireRateLimit(event, "runtime-error", {
      key: `${drop.id}:${who?.userId ?? "guest"}`,
      limit: 10,
      window: "1m",
    })
    const { version, errors } = await event.req.json()
    if (version === drop.version) await recordRuntimeErrors(drop.id, version, errors)
    return noContent()
  },
})
