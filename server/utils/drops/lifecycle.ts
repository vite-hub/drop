import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm"
import { log } from "evlog"
import { type H3Event } from "h3"
import { db } from "vite-hub/database/drizzle"
import { dropHeads, drops } from "../../databases/config"
import { slugify, dropPath } from "#shared/links"
import { DAY_MS, TEMPORARY_DAYS, TRASH_DAYS } from "#shared/expiry"
import { LIVE_EDITING } from "#live-drafts"
import { draftPath } from "../draft-paths"
import { deleteRetainedDrop } from "../quota-deletion"
import { chainOf, expiryPolicy } from "../expiry"
import type { Identity } from "../identity"
import type { DropRow } from "./types"
import { listDrops, findDrop } from "./query"
import { drainBlobCleanup, deleteBlobKeys } from "./write"

/**
 * Moves a drop (every version) to the Trash. Its links stop working; it's purged after 15 days. Everything below it goes
 * with it: the drops below read the Trash from their ancestors, so a folder takes one write.
 */
export async function trashDrop(row: DropRow, now = Date.now()) {
  await db
    .update(drops)
    .set({ trashedAt: now, trashReason: "deleted" })
    .where(sql`${drops.id} IN (${chainOf(row)})`)
}

/** Brings a drop back from the Trash with a fresh window, whether it was deleted or expired, and everything below it. */
export async function restoreDrop(row: DropRow, now = Date.now()) {
  await db
    .update(drops)
    .set({ trashedAt: null, trashReason: null, lastAccessedAt: now })
    .where(sql`${drops.id} IN (${chainOf(row)})`)
}

/**
 * Removes a drop for good: every version, its files, its comments, the files it embeds, and for a folder everything
 * in it, depth first. `gone` collects the deleted ids, so a chain is deleted once however many of its versions point here.
 */
export async function deleteDrop(row: DropRow, gone = new Set<string>()) {
  await drainBlobCleanup()
  const ids = (
    await db
      .select({ id: drops.id })
      .from(drops)
      .where(sql`${drops.id} IN (${chainOf(row)})`)
  ).map((item) => item.id)
  for (const id of ids) gone.add(id)
  const children = await db
    .select()
    .from(drops)
    .where(sql`${drops.parentId} IN (${chainOf(row)})`)
  for (const child of children) if (!gone.has(child.id)) await deleteDrop(child, gone)
  await deleteRetainedDrop(row, deleteBlobKeys)
  // Live drafts are Blob files too (#live-drafts), one per version anyone opened in the editor.
  if (row.kind === "markdown" && LIVE_EDITING) await deleteBlobKeys(ids.map(draftPath))
}

/** Every drop in someone's Trash, for "Empty Trash". */
export async function emptyTrash(who: Identity, event?: H3Event) {
  const trashed = await listDrops(who, event, { trash: true })
  for (const summary of trashed) {
    const row = await findDrop(summary.id, event)
    if (row) await deleteDrop(row)
  }
  return trashed.length
}

/**
 * The hourly cleanup, in bounded batches (the next run picks up the rest). Drops at the top past their window move to
 * the Trash as of when they expired (the drops below follow them); drops 15 days into the Trash, with everything below
 * them, and nodes whose parent is gone, are deleted.
 */
export async function deleteExpiredDrops(now: Date, limit = 50) {
  const at = now.getTime()
  const { days } = expiryPolicy()
  if (days) {
    const temporary = Math.min(TEMPORARY_DAYS, days)
    const lastSeen = sql`coalesce(${drops.lastAccessedAt}, ${drops.createdAt})`
    await db
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
  }
  const due = (
    await db
      .select({ drop: drops })
      .from(dropHeads)
      .innerJoin(drops, eq(drops.id, dropHeads.dropId))
      .where(lte(drops.trashedAt, at - TRASH_DAYS * DAY_MS))
      .limit(limit)
  ).map((row) => row.drop)
  const orphans = await db
    .select()
    .from(drops)
    .where(and(isNotNull(drops.parentId), sql`NOT EXISTS (SELECT 1 FROM drops p WHERE p.id = ${drops.parentId})`))
    .limit(limit)
  await drainBlobCleanup()
  for (const row of due) {
    await deleteDrop(row)
    log.info({ action: "drop-purged", drop: row.id, owner: row.ownerId, reason: row.trashReason })
  }
  for (const row of orphans) await deleteDrop(row)
  return due.length + orphans.length
}

/** The doc's share link, which opens its latest version. */
export const dropPageUrl = (
  origin: string,
  drop: Pick<DropRow, "id" | "title"> & { link: string | null; slug: string | null },
) => new URL(dropPath({ link: drop.link ?? drop.id, slug: drop.slug ?? slugify(drop.title) }), origin).href
