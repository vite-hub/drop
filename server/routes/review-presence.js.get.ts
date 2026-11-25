import { defineHandler } from "h3"
import { default as PRESENCE_CLIENT } from "@vite-hub/realtime/client/browser.js?raw"

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
