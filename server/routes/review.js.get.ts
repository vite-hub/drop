import { defineHandler } from "h3"
import { REVIEW_SCRIPT } from "#shared/review-script"

export default defineHandler(
  () =>
    new Response(REVIEW_SCRIPT, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "X-Content-Type-Options": "nosniff",
      },
    }),
)
