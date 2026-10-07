import { defineHandler } from "h3"
import { authFor, requireIdentity } from "../../utils/identity"
import { routeId } from "../../utils/params"

export default defineHandler(async (event) => {
  await requireIdentity(event)
  await authFor(event).api.deleteApiKey({ body: { keyId: await routeId(event) }, headers: event.req.headers })
  return { ok: true }
})
