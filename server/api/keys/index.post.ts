import { defineHandler, readValidatedBody } from "h3"
import * as v from "valibot"
import { authFor, requireIdentity } from "../../utils/identity"

/** Name the key after the agent that uses it ("Claude Code"): drops it makes show that name and logo. */
export default defineHandler(async (event) => {
  await requireIdentity(event)
  const { name } = await readValidatedBody(event, v.object({ name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60)) }))
  const created = await authFor(event).api.createApiKey({ body: { name }, headers: event.req.headers })
  return { id: created.id, key: created.key, name }
})
