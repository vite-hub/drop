import { defineHandler } from "h3"
import { githubOrganization } from "../utils/github-membership"

/** Organization instances never serve content to anonymous visitors, including shared files. */
export default defineHandler(async (event) => {
  if (!githubOrganization()) return
  const path = event.url.pathname
  if (path.startsWith("/api/auth/") && !path.startsWith("/api/auth/admin/")) return
  if (path === "/api/health" || path === "/api/mcp" || path === "/api/sign-in") return
  // A site's review script sends no session, only a review token, which carries a member and is checked there.
  if (/^\/api\/review\/[^/]+\/comments$/.test(path)) return
  // An upload URL sends no session either: its ticket carries the member, who must still be one (readUpload).
  if (/^\/api\/uploads\/[^/]+$/.test(path)) return
  if (/^\/(?:api|d|f|i)(?:\/|$)/.test(path)) {
    const { requireIdentity } = await import("../utils/identity")
    await requireIdentity(event)
    event.res.headers.set("Cache-Control", "private, no-store")
  }
})
