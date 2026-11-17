import { defineMiddleware } from "h3"
import * as v from "valibot"
import { requireAdmin, syncRole } from "../utils/identity"
import { logAudit } from "../utils/logs"

const AboutUser = v.object({ userId: v.string() })
const Created = v.object({ user: v.object({ id: v.string() }) })
// Better Auth's answer, a Response that may come from another realm (workerd, Vite's module runner), so not instanceof.
const Answered = v.object({ status: v.number(), clone: v.function() })

/**
 * Better Auth's admin POSTs that only read. Every other one changes an account, so an endpoint a Better Auth upgrade adds
 * is audited too.
 */
const READS = new Set(["has-permission", "list-user-sessions"])

/**
 * Direct Better Auth admin requests obey the same current DROP_ADMINS policy as the Console. One that changes an account
 * is an audit, with the outcome Better Auth answered.
 */
export default defineMiddleware(async (event, next) => {
  if (!event.url.pathname.startsWith("/api/auth/admin/")) return next()
  const who = await requireAdmin(event)
  await syncRole(who.userId)
  const endpoint = event.url.pathname.slice("/api/auth/admin/".length)
  if (event.req.method === "GET" || READS.has(endpoint)) return next()
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
    const ok = answered.success && answered.output.status < 400
    // A new account's id is only in the answer. revoke-user-session names a session token, which stays out of logs.
    if (ok && endpoint === "create-user") {
      const created = v.safeParse(
        Created,
        // SAFETY: Answered checked it is Response-shaped; instanceof can't, across realms.
        await (answer as Response)
          .clone()
          .json()
          .catch(() => null),
      )
      if (created.success) target.id = created.output.user.id
    }
    audit(ok)
    return answer
  } catch (error) {
    audit(false)
    throw error
  }
})
