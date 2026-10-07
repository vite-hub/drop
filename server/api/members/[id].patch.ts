import { defineValidatedHandler, HTTPError } from "h3"
import { MemberPatchSchema } from "#shared/schemas"
import { authFor, requireAdmin } from "../../utils/identity"
import { routeId } from "../../utils/params"

export default defineValidatedHandler({
  validate: { body: MemberPatchSchema },
  async handler(event) {
    const who = await requireAdmin(event)
    const userId = await routeId(event)
    if (userId === who.userId) throw new HTTPError({ status: 400, statusText: "You can't change your own role or ban yourself." })
    const body = await event.req.json()
    const api = authFor(event).api
    const headers = event.req.headers
    if (body.role) await api.setRole({ body: { userId, role: body.role }, headers })
    if (body.banned === true) await api.banUser({ body: { userId }, headers })
    if (body.banned === false) await api.unbanUser({ body: { userId }, headers })
    return { ok: true }
  },
})
