import { getEventContext, type H3EventContext } from "h3"
import { definePlugin } from "nitro"
import type { CardReason } from "#shared/content-unavailable"
import { background } from "../utils/logs"

declare module "h3" {
  interface H3EventContext {
    dropCardShown?: CardReason
  }
}

export default definePlugin((app) => {
  app.hooks!.hook("response", (response, event) => {
    const reason = getEventContext<H3EventContext>(event).dropCardShown
    if (!reason) return
    background.info({
      action: "client-event",
      client: { event: "card.shown", reason },
      path: new URL(event.req.url).pathname,
      status: response.status,
    })
  })
})
