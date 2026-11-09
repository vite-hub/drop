import { defineHandler } from "h3"
import { membersOnly } from "../utils/members"

/**
 * What a public link needs: one drop's page, files, comments and their images, and latest-version room
 * (server/realtime/latest.ts), and `/api/me`, which answers null to a stranger. Each checks the drop's share itself
 * (0.drop-access.ts, permissions, server/comments.ts), so a stranger reaches only what its owner made public.
 */
const PUBLIC_LINK =
  /^\/(?:d\/[^/]+(?:\/[^/]*)?|f\/[^/]+|api\/me|api\/links\/[^/]+|api\/drops\/[^/]+(?:\/(?:comments|visit))?|api\/comments\/[^/]+\/replies|api\/_vitehub\/realtime\/latest\/[^/]+|api\/_vitehub\/comments\/attachments\/[^/]+)$/

/**
 * The routes review.js calls from a site (shared/review-script.ts): threads, resolving, replies, their images, and the
 * docs that link to the page.
 */
const REVIEW_SCRIPT = /^\/api\/review\/(?:comments(?:\/[^/]+(?:\/replies)?)?|images\/[^/]+|related)$/

/** Members-only Drops serve anonymous visitors only the drops shared publicly; the rest of the app needs a member. */
export default defineHandler(async (event) => {
  if (!membersOnly()) return
  const path = event.url.pathname
  if (path.startsWith("/api/auth/") && !path.startsWith("/api/auth/admin/")) return
  if (path === "/api/health" || path === "/api/mcp" || path === "/api/sign-in") return
  // A site's review script sends no session, only a review token, which carries a member and is checked there. Before
  // it has one, the related route tells the page only whether a drop links to it.
  if (REVIEW_SCRIPT.test(path)) return
  // An upload URL sends no session either: its ticket carries the member, who must still be one (readUpload).
  if (/^\/api\/uploads\/[^/]+$/.test(path)) return
  if (/^\/(?:api|[dfi])(?:\/|$)/.test(path)) {
    event.res.headers.set("Cache-Control", "private, no-store")
    if (PUBLIC_LINK.test(path)) return
    const { requireIdentity } = await import("../utils/identity")
    await requireIdentity(event)
  }
})
