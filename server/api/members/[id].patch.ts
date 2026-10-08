import { eq } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { user } from "../../databases/config"
import { defineValidatedHandler, HTTPError } from "h3"
import { MemberPatchSchema } from "#shared/schemas"
import { authFor, requireAdmin } from "../../utils/identity"
import { routeId } from "../../utils/params"

export default defineValidatedHandler({
  validate: { body: MemberPatchSchema },
  async handler(event) {
    const who = await requireAdmin(event)
    const userId = await routeId(event)
    const body = await event.req.json()
    if (userId === who.userId && (body.role || body.banned !== undefined))
      throw new HTTPError({ status: 400, statusText: "You can't change your own role or ban yourself." })
    if (body.plan) {
      const changed = await db.update(user).set({ plan: body.plan }).where(eq(user.id, userId)).returning({ id: user.id })
      if (!changed.length) throw new HTTPError({ status: 404, statusText: "No member with that id." })
    }
    const api = authFor(event).api
    const headers = event.req.headers
    if (body.role) await api.setRole({ body: { userId, role: body.role }, headers })
    if (body.banned === true) await api.banUser({ body: { userId }, headers })
    if (body.banned === false) await api.unbanUser({ body: { userId }, headers })
    return { ok: true }
  },
})
