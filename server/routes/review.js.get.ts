import { defineHandler } from "h3"
import { REVIEW_SCRIPT } from "#shared/review-script"

/**
 * The review script sites add to their preview builds (see shared/review-script.ts). The same file for every site
 * and every Drop: it finds Drop's origin from its own src and the site drop from `data-drop`, so caches can share it.
 * Any site may load it (CORP cross-origin); what it sends is checked by /api/review.
 */
export default defineHandler(() => new Response(REVIEW_SCRIPT, {
  headers: {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
  },
}))
