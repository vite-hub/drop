import { defineHandler } from "h3"
import { HUB_SKILLS_PATH } from "#shared/links"
import { membersOnly } from "../utils/members"

/**
 * What a public link needs: one drop's page, files, comments and their images, and latest-version room
 * (server/realtime/latest.ts), and `/api/me`, which answers null to a stranger. Each checks the drop's share itself
 * (0.drop-access.ts, permissions, server/comments.ts), so a stranger reaches only what its owner made public.
 */
const PUBLIC_LINK =
  /^\/(?:d\/[^/]+(?:\/[^/]*)?|f\/[^/]+|api\/me|api\/links\/[^/]+|api\/drops\/[^/]+(?:\/(?:comments|visit))?|api\/comments\/[^/]+\/replies|_vitehub\/realtime\/latest\/[^/]+|(?:api\/)?_vitehub\/comments\/attachments\/[^/]+)$/

/**
 * The routes review.js calls from a site (shared/review-script.ts): threads, resolving, replies, their images, the docs
 * that link to the page, and its presence ticket.
 */
const REVIEW_SCRIPT = /^\/api\/review\/(?:comments(?:\/[^/]+(?:\/replies)?)?|images\/[^/]+|related|presence)$/

/**
 * Presence rooms (server/realtime/presence.ts) check everyone themselves: Drop's pages by session, and a reviewed site's
 * page by its presence ticket, which carries a member.
 */
const PRESENCE_ROOM = /^\/(?:api\/)?_vitehub\/realtime\/presence\/[^/]+$/

/**
 * The ViteHub routes that answer for Drop's data: Comments, Realtime rooms, browser errors, and the Console's status,
 * logs and usage. They sit under /_vitehub beside routes that check a signature or serve static files (the Console's
 * /_vitehub/rpc, its tool script, the Comments overlay assets), which stay open.
 */
const VITEHUB_DATA =
  /^\/_vitehub\/(?:comments(?!\/assets\/)|realtime|browser-errors|console\/(?:status|logs|usage))(?:\/|$)/

/**
 * Send's pair route: a member's agent posts its setup code from its own machine, with no session. The one-use code is
 * its only key, and ViteHub checks it (server/comments.ts).
 */
const SEND_PAIR = /^\/(?:api\/)?_vitehub\/comments\/send\/pair$/

/** Members-only Drops serve anonymous visitors only the drops shared publicly; the rest of the app needs a member. */
export default defineHandler(async (event) => {
  if (!membersOnly()) return
  const path = event.url.pathname
  if (path.startsWith("/api/auth/") && !path.startsWith("/api/auth/admin/")) return
  if (path === "/api/health" || path === "/api/mcp" || path === "/api/sign-in") return
  // Site icons (server/utils/favicons.ts) load from docs' frames, which send no session, and say nothing about drops.
  if (path.startsWith("/api/favicons/")) return
  // A site's review script sends no session, only a review token, which carries a member and is checked there. Before
  // it has one, the related route tells the page only whether a drop links to it.
  if (REVIEW_SCRIPT.test(path) || PRESENCE_ROOM.test(path) || SEND_PAIR.test(path)) return
  // An upload URL sends no session either: its ticket carries the member, who must still be one (readUpload).
  if (/^\/api\/uploads\/[^/]+$/.test(path)) return
  if (/^\/(?:api|[dfi])(?:\/|$)/.test(path) || VITEHUB_DATA.test(path)) {
    event.res.headers.set("Cache-Control", "private, no-store")
    // A public folder's skills (../utils/hub-skills.ts) serve what that folder's page shows a stranger.
    if (PUBLIC_LINK.test(path) || HUB_SKILLS_PATH.test(path)) return
    const { requireIdentity } = await import("../utils/identity")
    await requireIdentity(event)
  }
})
