import { desc, getTableColumns, sql } from "drizzle-orm"
import { defineHandler } from "h3"
import { db } from "vite-hub/database/drizzle"
import { session, user } from "../../databases/config"
import type { Member } from "#shared/types"
import { requireIdentity, roleOf } from "../../utils/identity"

/** Everyone in this Drop. Anyone signed in can see who's here; only admins see emails and ban people. Roles come from DROP_ADMINS. */
export default defineHandler(async (event): Promise<Member[]> => {
  const who = await requireIdentity(event)
  // One query: listing user ids to count by would pass D1's 100 bound parameters once a Drop has more people.
  // Columns are spelled out with their tables: drizzle leaves them bare in a one-table select, and a bare "id" inside
  // the subquery would mean the subquery's own table.
  const users = await db.select({
    ...getTableColumns(user),
    // What their Drops page lists: latest versions only, no folders, no files a doc embeds, nothing in the Trash.
    drops: sql<number>`(SELECT count(*) FROM drop_heads h JOIN drops d ON d.id = h.drop_id WHERE h.owner_id = "user"."id"
      AND d.kind != 'folder' AND d.trashed_at IS NULL
      AND (d.parent_id IS NULL OR EXISTS (SELECT 1 FROM drops p WHERE p.id = d.parent_id AND p.kind = 'folder')))`.mapWith(Number),
    seen: sql<Date | null>`(SELECT max(s.updated_at) FROM session s WHERE s.user_id = "user"."id")`.mapWith(session.updatedAt),
  }).from(user).orderBy(desc(user.createdAt)).limit(500)
  return users.map(member => ({
    id: member.id,
    name: member.name,
    email: who.role === "admin" || member.id === who.userId ? member.email : null,
    image: member.image ?? null,
    role: roleOf(member),
    banned: Boolean(member.banned),
    drops: member.drops,
    lastActiveAt: member.seen ? new Date(member.seen).getTime() : null,
    you: member.id === who.userId,
  }))
})
