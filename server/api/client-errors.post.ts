import { useLogger } from "evlog/nitro/v3"
import { defineValidatedHandler, noContent } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { ClientErrorSchema } from "#shared/schemas"

export default defineValidatedHandler({
  validate: { body: ClientErrorSchema },
  async handler(event) {
    await requireRateLimit(event, "client-error", { limit: 20, window: "1m" })
    const body = await event.req.json()
    useLogger(event).error(`Client: ${body.message}`, { action: "client-error", client: body })
    return noContent()
  },
})
