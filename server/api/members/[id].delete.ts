import { defineHandler, HTTPError } from "h3"
import { authFor, requireAdmin } from "../../utils/identity"
import { routeId } from "../../utils/params"

/** Removes someone. Their drops stay, owned by their (now deleted) id, until an admin deletes them. */
export default defineHandler(async (event) => {
  const who = await requireAdmin(event)
  const userId = await routeId(event)
  if (userId === who.userId) throw new HTTPError({ status: 400, statusText: "You can't remove yourself." })
  await authFor(event).api.removeUser({ body: { userId }, headers: event.req.headers })
  return { ok: true }
})
