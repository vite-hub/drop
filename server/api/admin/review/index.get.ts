import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm"
import { defineHandler } from "h3"
import { db } from "vite-hub/database/drizzle"
import { drops, user } from "../../../databases/config"
import { requireAdmin } from "../../../utils/identity"

export default defineHandler(async (event) => {
  await requireAdmin(event)
  event.res.headers.set("Cache-Control", "private, no-store")
  const pending = await db.select().from(drops).where(and(eq(drops.visibility, "shared"), isNotNull(drops.shareReview))).orderBy(sql`CASE WHEN ${drops.shareReview} = 'pending' THEN 0 ELSE 1 END`, desc(drops.updatedAt)).limit(200)
  const ids = [...new Set(pending.map(drop => drop.ownerId))]
  return Promise.all(ids.map(async (id) => {
    const [owner] = await db.select({ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, githubCreatedAt: user.githubCreatedAt, banned: user.banned }).from(user).where(eq(user.id, id)).limit(1)
    const [total] = await db.select({ n: count() }).from(drops).where(eq(drops.ownerId, id))
    return { ...owner, id, drops: total?.n ?? 0, shares: pending.filter(drop => drop.ownerId === id).map(drop => ({ id: drop.id, title: drop.title, shareReview: drop.shareReview, quarantinedAt: drop.quarantinedAt })) }
  }))
})
