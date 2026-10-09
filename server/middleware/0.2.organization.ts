import { defineHandler } from "h3"
import { githubOrganization } from "../utils/github-membership"

/** Organization instances never serve content to anonymous visitors, including shared files. */
export default defineHandler(async (event) => {
  if (!githubOrganization) return
  const path = event.url.pathname
  if (path.startsWith("/api/auth/") && !path.startsWith("/api/auth/admin/")) return
  if (path === "/api/health" || path === "/api/mcp") return
  if (/^\/(?:api|d|f|i)(?:\/|$)/.test(path)) {
    const { requireIdentity } = await import("../utils/identity")
    await requireIdentity(event)
    event.res.headers.set("Cache-Control", "private, no-store")
  }
})
