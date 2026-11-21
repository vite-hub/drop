import { defineHandler } from "h3"
import PRESENCE_CLIENT from "virtual:review-presence"

export default defineHandler(
  () =>
    new Response(PRESENCE_CLIENT, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "X-Content-Type-Options": "nosniff",
      },
    }),
)
