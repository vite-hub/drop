import { defineHandler } from "h3"
import PRESENCE_CLIENT from "virtual:review-presence"

/**
 * The presence client review.js imports once someone connects on a reviewed site (scripts/review-presence.ts). Like
 * /review.js it's the same file for every site and every Drop, so any site may load it: a module from another origin
 * needs CORS, and it carries nothing private.
 */
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
