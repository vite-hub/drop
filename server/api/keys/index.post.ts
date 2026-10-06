import { defineValidatedHandler } from "h3"
import { ApiKeySchema } from "#shared/schemas"
import { authFor, requireIdentity } from "../../utils/identity"

/** Name the key after the agent that uses it ("Claude Code"): drops it makes show that name and logo. */
export default defineValidatedHandler({
  validate: { body: ApiKeySchema },
  async handler(event) {
    await requireIdentity(event)
    const { name } = await event.req.json()
    const created = await authFor(event).api.createApiKey({ body: { name }, headers: event.req.headers })
    return { id: created.id, key: created.key, name }
  },
})
