import { defineHandler } from "h3"
import * as v from "valibot"
import { requireAdmin, syncRole } from "../utils/identity"
import { logAudit } from "../utils/logs"

const AboutUser = v.object({ userId: v.string() })

/** Direct Better Auth admin requests obey the same current DROP_ADMINS policy as the Console. */
export default defineHandler(async (event) => {
  if (!event.url.pathname.startsWith("/api/auth/admin/")) return
  const who = await requireAdmin(event)
  await syncRole(who.userId)
  if (event.req.method === "GET") return
  // Bans, unbans, removals, and session revocations, by the person they're about. Better Auth reads the body after.
  const body = v.safeParse(
    AboutUser,
    await event.req
      .clone()
      .json()
      .catch(() => null),
  )
  const action = `auth-admin.${event.url.pathname.slice("/api/auth/admin/".length)}`
  logAudit(event, who, action, { type: "user", id: body.success ? body.output.userId : "unknown" })
})
