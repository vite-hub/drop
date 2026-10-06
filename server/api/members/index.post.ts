import { defineHandler, readValidatedBody } from "h3"
import * as v from "valibot"
import { DEFAULT_ROLE, ROLES } from "#shared/roles"
import { authFor, requireAdmin } from "../../utils/identity"

const Body = v.object({
  email: v.pipe(v.string(), v.trim(), v.toLowerCase(), v.email()),
  role: v.optional(v.picklist(ROLES), DEFAULT_ROLE),
})

/** Invites someone: they can sign in with GitHub using this email. */
export default defineHandler(async (event) => {
  await requireAdmin(event)
  const { email, role } = await readValidatedBody(event, Body)
  const { user } = await authFor(event).api.createUser({
    body: { email, name: email.split("@")[0]!, role, password: crypto.randomUUID() + crypto.randomUUID() },
    headers: event.req.headers,
  })
  return { id: user.id }
})
