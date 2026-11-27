import { useLogger } from "evlog/nitro/v3"
import { defineValidatedHandler, noContent } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { ClientEventSchema } from "#shared/schemas"
import { clientAddress } from "../utils/client-address"

export default defineValidatedHandler({
  validate: { body: ClientEventSchema },
  async handler(event) {
    await requireRateLimit(event, "client-event", { key: clientAddress(event), limit: 30, window: "1m" })
    const body = await event.req.json()
    useLogger(event).info(`Client: ${body.event}`, { action: "client-event", client: body })
    return noContent()
  },
})
