import { H3Event } from "h3"
import * as v from "valibot"
import { defineConsoleAuthorize } from "vite-hub/console/auth"
import { contentHost } from "./utils/content-origin"
import { db } from "vite-hub/database"
import { eq } from "drizzle-orm"
import { user as users } from "./databases/default/index"
import { roleOf, syncRole } from "./utils/identity"
import { isMember } from "./utils/members"

const Operator = v.object({
  id: v.string(),
  email: v.string(),
  emailVerified: v.literal(true),
  banned: v.optional(v.nullable(v.boolean())),
})

export default defineConsoleAuthorize(async (context) => {
  if (contentHost(new H3Event(context.request))) return new Response(null, { status: 404 })
  switch (context.via) {
    case "console": {
      const email = context.user.email
      if (!email || roleOf({ email, emailVerified: true }) !== "admin") return false
      const [person] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1)
      if (person) await syncRole(person.id)
      return true
    }
    case "cli":
      return true
    case "agent":
      return false
    case "page": {
      const parsed = v.safeParse(Operator, context.user)
      if (!parsed.success || parsed.output.banned || roleOf(parsed.output) !== "admin") return false
      return isMember(parsed.output.id, context.request)
    }
    default:
      return true
  }
})
