import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm"
import { type H3Event } from "h3"
import { db } from "vite-hub/database"
import { drops, dropVersions } from "../../databases/default/index"
import { slugify, dropPath } from "#shared/links"
import { DAY_MS, TEMPORARY_DAYS, TRASH_DAYS } from "#shared/expiry"
import { LIVE_EDITING } from "../live-drafts"
import { draftPath } from "#shared/draft-paths"
import { deleteRetainedDrop } from "../quota-deletion"
import { commentCleanupFor, drainCommentCleanup } from "../comments"
import { expiryPolicy } from "../expiry"
import type { Identity } from "../identity"
import { logAudit } from "../logs"
import type { DropRow } from "./types"
import { listDrops, findDrop } from "./query"
import { drainBlobCleanup, deleteBlobKeys } from "./write"

export async function trashDrop(row: DropRow, now = Date.now()) {
  await db.update(drops).set({ trashedAt: now, trashReason: "deleted" }).where(eq(drops.id, row.id))
}

export async function restoreDrop(row: DropRow, now = Date.now()) {
  const restored = { trashedAt: null, trashReason: null, lastAccessedAt: now }
  const restore = (fields: Partial<typeof drops.$inferInsert>) =>
    db.update(drops).set(fields).where(eq(drops.id, row.id))
  await (row.role ? restore(restored).catch(() => restore({ ...restored, role: null })) : restore(restored))
}

export async function deleteDrop(row: DropRow, gone = new Set<string>()) {
  await drainBlobCleanup()
  gone.add(row.id)
  const [children, versions] = await Promise.all([
    db.select().from(drops).where(eq(drops.parentId, row.id)),
    db.select({ version: dropVersions.version }).from(dropVersions).where(eq(dropVersions.dropId, row.id)),
  ])
  for (const child of children) if (!gone.has(child.id)) await deleteDrop(child, gone)
  await deleteRetainedDrop(row, deleteBlobKeys, await commentCleanupFor(row))
  await drainCommentCleanup()
  if (row.kind === "markdown" && LIVE_EDITING)
    await deleteBlobKeys([row.version, ...versions.map((item) => item.version)].map((n) => draftPath(row.id, n)))
}

export async function emptyTrash(who: Identity, event?: H3Event) {
  const trashed = await listDrops(who, event, { trash: true })
  for (const summary of trashed) {
    const row = await findDrop(summary.id, event)
    if (row) await deleteDrop(row)
  }
  logAudit(event, who, "trash.empty", { type: "user", id: who.userId, deleted: trashed.length })
  return trashed.length
}

export async function deleteExpiredDrops(
  now: Date,
  limit = 50,
  note: (deleted: { id: string; owner: string; reason: string | null }) => void = () => {},
) {
  const at = now.getTime()
  const { days } = expiryPolicy()
  let expired = 0
  if (days) {
    const temporary = Math.min(TEMPORARY_DAYS, days)
    const lastSeen = sql`coalesce(${drops.lastAccessedAt}, ${drops.createdAt})`
    const moved = await db
      .update(drops)
      .set({
        trashedAt: sql`${lastSeen} + (CASE ${drops.lifetime} WHEN 'temporary' THEN ${temporary} ELSE ${days} END) * ${DAY_MS}`,
        trashReason: "expired",
      })
      .where(
        and(
          isNull(drops.trashedAt),
          isNull(drops.parentId),
          sql`${drops.lifetime} != 'keep'`,
          sql`${lastSeen} <= ${at} - (CASE ${drops.lifetime} WHEN 'temporary' THEN ${temporary} ELSE ${days} END) * ${DAY_MS}`,
        ),
      )
      .returning({ id: drops.id })
    expired = moved.length
  }
  const due = await db
    .select()
    .from(drops)
    .where(lte(drops.trashedAt, at - TRASH_DAYS * DAY_MS))
    .limit(limit)
  const orphans = await db
    .select()
    .from(drops)
    .where(and(isNotNull(drops.parentId), sql`NOT EXISTS (SELECT 1 FROM drops p WHERE p.id = ${drops.parentId})`))
    .limit(limit)
  await drainBlobCleanup()
  await drainCommentCleanup()
  for (const row of due) {
    await deleteDrop(row)
    note({ id: row.id, owner: row.ownerId, reason: row.trashReason })
  }
  for (const row of orphans) {
    await deleteDrop(row)
    note({ id: row.id, owner: row.ownerId, reason: "orphan" })
  }
  return { expired, purged: due.length, orphans: orphans.length }
}

export const dropPageUrl = (origin: string, drop: Pick<DropRow, "id" | "title" | "slug">) =>
  new URL(dropPath({ link: drop.id, slug: drop.slug ?? slugify(drop.title) }), origin).href
