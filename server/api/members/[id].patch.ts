import { defineHandler, getRouterParam, HTTPError, readValidatedBody } from "h3"
import * as v from "valibot"
import { ROLES } from "#shared/roles"
import { authFor, requireAdmin } from "../../utils/identity"

const Body = v.object({ role: v.optional(v.picklist(ROLES)), banned: v.optional(v.boolean()) })

export default defineHandler(async (event) => {
  const who = await requireAdmin(event)
  const userId = getRouterParam(event, "id") ?? ""
  if (userId === who.userId) throw new HTTPError({ status: 400, statusText: "You can't change your own role or ban yourself." })
  const body = await readValidatedBody(event, Body)
  const api = authFor(event).api
  const headers = event.req.headers
  if (body.role) await api.setRole({ body: { userId, role: body.role }, headers })
  if (body.banned === true) await api.banUser({ body: { userId }, headers })
  if (body.banned === false) await api.unbanUser({ body: { userId }, headers })
  return { ok: true }
})
