import { useLogger } from "evlog/nitro/v3"
import { defineValidatedHandler, noContent } from "h3"
import type * as v from "valibot"
import { useServerEnv } from "vite-hub/env"
import { requireRateLimit } from "vite-hub/rate-limit"
import { ClientEventSchema } from "#shared/schemas"
import { clientAddress } from "../utils/client-address"
import { countUsage } from "../utils/ui-usage"

export default defineValidatedHandler({
  validate: { body: ClientEventSchema },
  async handler(event) {
    // SAFETY: `validate` has checked the body against ClientEventSchema.
    const body = (await event.req.json()) as v.InferOutput<typeof ClientEventSchema>
    if (body.event === "ui.usage") {
      if (!useServerEnv(event).drop.usageCounts) return noContent()
      await requireRateLimit(event, "ui-usage", { key: clientAddress(event), limit: 30, window: "1m" })
      await countUsage(body.counts)
    } else await requireRateLimit(event, "client-event", { key: clientAddress(event), limit: 30, window: "1m" })
    useLogger(event).info(`Client: ${body.event}`, { action: "client-event", client: body })
    return noContent()
  },
})
