import { defineHandler } from "h3"
import { HUB_SKILLS_PATH } from "#shared/links"
import { membersOnly } from "../utils/members"

const PUBLIC_LINK =
  /^\/(?:d\/[^/]+(?:\/[^/]*)?|f\/[^/]+|api\/me|api\/links\/[^/]+|api\/drops\/(?!peeks$|tree$)[^/]+(?:\/(?:comments|visit))?|api\/comments\/[^/]+\/replies|_vitehub\/realtime\/latest\/[^/]+|(?:api\/)?_vitehub\/comments\/attachments\/[^/]+)$/

const REVIEW_SCRIPT = /^\/api\/review\/(?:comments(?:\/[^/]+(?:\/replies)?)?|images\/[^/]+|related|presence)$/

const PRESENCE_ROOM = /^\/(?:api\/)?_vitehub\/realtime\/presence\/[^/]+$/

const VITEHUB_DATA = /^\/_vitehub\/(?:comments(?!\/assets\/)|realtime|console\/(?:status|logs|usage))(?:\/|$)/

const SEND_PAIR = /^\/(?:api\/)?_vitehub\/comments\/send\/pair$/

export default defineHandler(async (event) => {
  if (!membersOnly()) return
  const path = event.url.pathname
  if (path.startsWith("/api/auth/") && !path.startsWith("/api/auth/admin/")) return
  if (path === "/api/health" || path === "/api/mcp" || path === "/api/sign-in" || path === "/api/client-events") return
  if (path.startsWith("/api/favicons/")) return
  if (path === "/_vitehub/browser-errors") return
  if (REVIEW_SCRIPT.test(path) || PRESENCE_ROOM.test(path) || SEND_PAIR.test(path)) return
  if (/^\/api\/uploads\/[^/]+$/.test(path)) return
  if (/^\/(?:api|[dfi])(?:\/|$)/.test(path) || VITEHUB_DATA.test(path)) {
    event.res.headers.set("Cache-Control", "private, no-store")
    if (PUBLIC_LINK.test(path) || HUB_SKILLS_PATH.test(path)) return
    const { requireIdentity } = await import("../utils/identity")
    await requireIdentity(event)
  }
})
