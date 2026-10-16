import { desc, getTableColumns, sql } from "drizzle-orm"
import { defineHandler } from "h3"
import { db } from "vite-hub/database/drizzle"
import { session, user } from "../../databases/config"
import { isRole } from "#shared/roles"
import type { Member } from "#shared/types"
import { requireIdentity } from "../../utils/identity"

/** Everyone in this Drop. Anyone signed in can see who's here; only admins see emails and change it. */
export default defineHandler(async (event): Promise<Member[]> => {
  const who = await requireIdentity(event)
  // One query: listing user ids to count by would pass D1's 100 bound parameters once a Drop has more people.
  // Columns are spelled out with their tables: drizzle leaves them bare in a one-table select, and a bare "id" inside
  // the subquery would mean the subquery's own table.
  const users = await db.select({
    ...getTableColumns(user),
    drops: sql<number>`(SELECT count(*) FROM drops d WHERE d.owner_id = "user"."id")`.mapWith(Number),
    seen: sql<Date | null>`(SELECT max(s.updated_at) FROM session s WHERE s.user_id = "user"."id")`.mapWith(session.updatedAt),
  }).from(user).orderBy(desc(user.createdAt)).limit(500)
  return users.map(user => ({
    id: user.id,
    name: user.name,
    email: who.role === "admin" || user.id === who.userId ? user.email : null,
    image: user.image ?? null,
    role: isRole(user.role ?? "") ? user.role as Member["role"] : "member",
    banned: Boolean(user.banned),
    drops: user.drops,
    lastActiveAt: user.seen ? new Date(user.seen).getTime() : null,
    you: user.id === who.userId,
  }))
})
