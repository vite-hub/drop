import { H3Event } from "h3"
import * as v from "valibot"
import { defineConsoleAuthorize } from "vite-hub/console/auth"
import { contentHost } from "./utils/content-origin"
import { roleOf } from "./utils/identity"
import { syncConsoleRoles } from "./utils/auth-console"
import { isMember } from "./utils/members"

const Operator = v.object({
  id: v.string(),
  email: v.string(),
  emailVerified: v.literal(true),
  banned: v.optional(v.nullable(v.boolean())),
})

/** Console data and operations need a current, verified Drop admin using a browser session. */
export default defineConsoleAuthorize(async ({ request, user }) => {
  if (contentHost(new H3Event(request)) || request.headers.has("authorization")) return false
  const parsed = v.safeParse(Operator, user)
  if (!parsed.success || parsed.output.banned || roleOf(parsed.output) !== "admin") return false
  if (!(await isMember(parsed.output.id))) return false
  // Refresh all accounts before Console reads roles or applies its Admins filter.
  await syncConsoleRoles()
  return { sections: ["auth"] }
})
