import { useLogger } from "evlog/nitro/v3"
import { defineValidatedHandler } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { ClientErrorSchema } from "#shared/schemas"

/**
 * Errors from the browser, so a toast like "Couldn't copy" leaves a trace in the logs. Anonymous: it never asks who
 * sent it, so the event carries no user, and the page sends its path without the query.
 */
export default defineValidatedHandler({
  validate: { body: ClientErrorSchema },
  async handler(event) {
    await requireRateLimit(event, "client-error", { limit: 20, window: "1m" })
    const body = await event.req.json()
    // An error-level event, so it's kept even though the request itself succeeds.
    useLogger(event).error(`Client: ${body.message}`, { action: "client-error", client: body })
    return new Response(null, { status: 204 })
  },
})
