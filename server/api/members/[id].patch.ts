import { defineValidatedHandler, HTTPError } from "h3"
import { MemberPatchSchema } from "#shared/schemas"
import { authFor, requireAdmin, syncRole } from "../../utils/identity"
import { routeId } from "../../utils/params"

/** Ban or unban someone. Roles aren't set here: `DROP_ADMINS` names the admins. */
export default defineValidatedHandler({
  validate: { body: MemberPatchSchema },
  async handler(event) {
    const who = await requireAdmin(event)
    const userId = await routeId(event)
    const body = await event.req.json()
    if (userId === who.userId) throw new HTTPError({ status: 400, statusText: "You can't ban yourself." })
    // Better Auth checks the role stored on the account; an admin named in DROP_ADMINS since signing in has none yet.
    await syncRole(who.userId)
    const api = authFor(event).api
    const headers = event.req.headers
    if (body.banned) await api.banUser({ body: { userId }, headers })
    else await api.unbanUser({ body: { userId }, headers })
    return { ok: true }
  },
})
