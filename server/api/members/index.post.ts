import { defineValidatedHandler } from "h3"
import { InviteSchema } from "#shared/schemas"
import { authFor, requireAdmin } from "../../utils/identity"

/** Invites someone: they can sign in with GitHub using this email. */
export default defineValidatedHandler({
  validate: { body: InviteSchema },
  async handler(event) {
    await requireAdmin(event)
    const { email, role } = await event.req.json()
    const { user } = await authFor(event).api.createUser({
      body: { email, name: email.split("@")[0]!, role, password: crypto.randomUUID() + crypto.randomUUID() },
      headers: event.req.headers,
    })
    return { id: user.id }
  },
})
