import { defineHandler } from "h3"
import { requireAdmin, syncRole } from "../utils/identity"

/** Direct Better Auth admin requests obey the same current DROP_ADMINS policy as the Console. */
export default defineHandler(async (event) => {
  if (!event.url.pathname.startsWith("/api/auth/admin/")) return
  const who = await requireAdmin(event)
  await syncRole(who.userId)
})
