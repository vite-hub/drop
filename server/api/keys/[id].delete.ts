import { defineHandler, getRouterParam } from "h3"
import { authFor, requireIdentity } from "../../utils/identity"

export default defineHandler(async (event) => {
  await requireIdentity(event)
  await authFor(event).api.deleteApiKey({ body: { keyId: getRouterParam(event, "id") ?? "" }, headers: event.req.headers })
  return { ok: true }
})
