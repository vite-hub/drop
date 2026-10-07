import { count, desc, max } from "drizzle-orm"
import { defineHandler } from "h3"
import { db } from "vite-hub/database/drizzle"
import { drops as dropsTable, session, user } from "../../databases/config"
import { isRole } from "#shared/roles"
import type { Member } from "#shared/types"
import { requireIdentity } from "../../utils/identity"

/** Everyone in this Drop. Anyone signed in can see who's here; only admins change it. */
export default defineHandler(async (event): Promise<Member[]> => {
  const who = await requireIdentity(event)
  const users = await db.select().from(user).orderBy(desc(user.createdAt)).limit(500)
  const drops = await db.select({ ownerId: dropsTable.ownerId, total: count() }).from(dropsTable).groupBy(dropsTable.ownerId)
  const seen = await db.select({ userId: session.userId, at: max(session.updatedAt) }).from(session).groupBy(session.userId)
  return users.map(user => ({
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image ?? null,
    role: isRole(user.role ?? "") ? user.role as Member["role"] : "member",
    banned: Boolean(user.banned),
    drops: drops.find(row => row.ownerId === user.id)?.total ?? 0,
    lastActiveAt: (() => {
      const at = seen.find(row => row.userId === user.id)?.at
      return at ? new Date(at).getTime() : null
    })(),
    you: user.id === who.userId,
  }))
})
