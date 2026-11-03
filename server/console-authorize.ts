import { H3Event } from "h3"
import * as v from "valibot"
import { defineConsoleAuthorize } from "vite-hub/console/auth"
import { contentHost } from "./utils/content-origin"
import { roleOf, syncRole } from "./utils/identity"
import { isMember } from "./utils/members"

const Operator = v.object({
  id: v.string(),
  email: v.string(),
  emailVerified: v.literal(true),
  banned: v.optional(v.nullable(v.boolean())),
})

/**
 * The Console, its pages included, is for a current, verified Drop admin using a browser session, who sees every
 * section. Anyone else signed in, agents too, gets a 404 as if Drop had none; a signed-out visit goes to /signin
 * (nuxt.config `console.signInPage`). The content origin never serves any of it (middleware/0.05).
 */
export default defineConsoleAuthorize(async ({ request, user }) => {
  const hidden = new Response(null, { status: 404 })
  if (contentHost(new H3Event(request)) || request.headers.has("authorization")) return hidden
  const parsed = v.safeParse(Operator, user)
  if (!parsed.success || parsed.output.banned || roleOf(parsed.output) !== "admin") return hidden
  if (!(await isMember(parsed.output.id))) return hidden
  // Better Auth's admin endpoints read the operator's stored role.
  await syncRole(parsed.output.id)
  // Grant all sections, including Comments for the page toolbar, Console triage, and ViteHub MCP tools.
  return true
})
