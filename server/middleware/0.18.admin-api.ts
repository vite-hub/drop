import { defineMiddleware } from "h3"
import * as v from "valibot"
import { requireAdmin, syncRole } from "../utils/identity"
import { logAudit } from "../utils/logs"

const AboutUser = v.object({ userId: v.string() })
const Answered = v.object({ status: v.number() })

/** Better Auth's admin endpoints that change an account; the rest only read. */
const CHANGES = new Set([
  "create-user",
  "update-user",
  "remove-user",
  "ban-user",
  "unban-user",
  "set-user-password",
  "set-role",
  "revoke-user-session",
  "revoke-user-sessions",
  "remove-user-sessions",
])

/**
 * Direct Better Auth admin requests obey the same current DROP_ADMINS policy as the Console. One that changes an account
 * is an audit, with the outcome Better Auth answered.
 */
export default defineMiddleware(async (event, next) => {
  if (!event.url.pathname.startsWith("/api/auth/admin/")) return next()
  const who = await requireAdmin(event)
  await syncRole(who.userId)
  const endpoint = event.url.pathname.slice("/api/auth/admin/".length)
  if (event.req.method === "GET" || !CHANGES.has(endpoint)) return next()
  // Better Auth reads the body after this.
  const body = v.safeParse(
    AboutUser,
    await event.req
      .clone()
      .json()
      .catch(() => null),
  )
  const target = { type: "user", id: body.success ? body.output.userId : "unknown" }
  const audit = (ok: boolean) => logAudit(event, who, `auth-admin.${endpoint}`, target, ok ? "success" : "failure")
  try {
    const answer = await next()
    const answered = v.safeParse(Answered, answer)
    audit(!answered.success || answered.output.status < 400)
    return answer
  } catch (error) {
    audit(false)
    throw error
  }
})
