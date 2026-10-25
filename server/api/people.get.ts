import { asc, eq, isNull, or } from "drizzle-orm"
import { defineHandler } from "h3"
import { db } from "vite-hub/database/drizzle"
import { user } from "../databases/config"
import { requireIdentity } from "../utils/identity"

/** Names and avatars for the editor's @ suggestions. Administrative data belongs in the Console. */
export default defineHandler(async (event) => {
  await requireIdentity(event)
  return db
    .select({ id: user.id, name: user.name, image: user.image })
    .from(user)
    .where(or(eq(user.banned, false), isNull(user.banned)))
    .orderBy(asc(user.name), asc(user.id))
    .limit(500)
})
