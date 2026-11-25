import { H3Event } from "h3"
import { defineConsoleAuthorize } from "vite-hub/console/auth"
import { contentHost } from "./utils/content-origin"
import { db } from "vite-hub/database"
import { eq } from "drizzle-orm"
import { user as users } from "./databases/default/index"
import { roleOf, syncRole } from "./utils/identity"

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
    default:
      return true
  }
})
