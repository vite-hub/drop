import { sql } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { newLink, slugify } from "#shared/links"
import { MAX_DEPTH } from "#shared/nodes"
import type { Access, Visibility } from "#shared/types"
import { drops } from "../databases/config"
import { type DropRow, findDropByRef, lifetimeFields, type LifetimeInput, permissions } from "./drops"
import { chainOf } from "./expiry"
import type { Identity } from "./identity"
import { depthOf, heightOf, touchFolder, uniqueSlug } from "./nodes"
import { withDropQuota } from "./quotas"
import { shareReviewFor } from "./trust"

/**
 * The folder `ref` names (its id, its link's key, or its share link) when the caller may put drops in it: their own
 * folders, or any as an editor or admin. `moving` is a drop already somewhere that would go in, subtree and all.
 */
export async function requireFolder(ref: string, who: Identity, event?: H3Event, moving?: DropRow) {
  const folder = await findDropByRef(ref, event)
  if (!folder || folder.kind !== "folder" || !permissions(folder, who).manage) throw new HTTPError({ status: 404, statusText: `No folder you can add to with id ${ref}.` })
  if (folder.expired) throw new HTTPError({ status: 409, statusText: `${folder.title} is in the Trash. Restore it first.` })
  if (moving && (folder.id === moving.id || folder.ancestors?.some(node => node.id === moving.id)))
    throw new HTTPError({ status: 400, statusText: "A folder can't go inside itself." })
  if (moving && folder.ownerId !== moving.ownerId) throw new HTTPError({ status: 400, statusText: "A folder holds its owner's drops only." })
  if (depthOf(folder) + (moving ? await heightOf(moving) : 1) > MAX_DEPTH) throw new HTTPError({ status: 400, statusText: `Folders nest ${MAX_DEPTH} levels deep at most.` })
  return folder
}

/**
 * Creates a folder, at the top or inside `folder`. A folder has no file: a title, a link, and the drops in it, which
 * share and live with it. One inside another folder takes that folder's lifetime. It isn't a drop for the plan's count.
 */
export async function createFolder(who: Identity, input: LifetimeInput & { title: string; slug?: string; folder?: DropRow; visibility?: Visibility; access?: Access }, event?: H3Event) {
  const title = input.title.trim().slice(0, 160) || "Untitled folder"
  const parent = input.folder ?? null
  const ownerId = parent?.ownerId ?? who.userId
  const life = parent ? lifetimeFields(who, {}, parent, event) : lifetimeFields(who, input, null, event)
  const visibility = input.visibility ?? "private"
  return withDropQuota(ownerId, { drops: 0, bytes: 0, writes: 0 }, event, async (quota) => {
    const now = Date.now()
    const slug = await uniqueSlug(parent?.id ?? null, (input.slug && slugify(input.slug)) || slugify(title))
    const row: DropRow = {
      id: crypto.randomUUID(), ownerId, kind: "folder", title, filename: `${slug || "folder"}/`,
      blobKey: null, contentType: null, size: 0, version: 1, supersedesId: null, link: newLink(), slug,
      visibility, access: input.access ?? "comment", shareReview: visibility !== "private" ? await shareReviewFor(ownerId, event) : null, quarantinedAt: null,
      actorKind: who.actorKind, actorName: who.actorName, createdAt: now, updatedAt: now, lastAccessedAt: now,
      ...life, note: input.note?.trim() || null, trashedAt: null, trashReason: null, parentId: parent?.id ?? null, siteUrl: null, publishToken: null,
    }
    await quota.commit([db.insert(drops).values(row), ...(parent ? [touchFolder(parent.id, now)] : [])])
    return row
  })
}

/**
 * Moves a drop, every version of it, into a folder, or to the top with null. From then on it shares and lives with
 * its new ancestors, and its slug gets a number if the folder has one like it. A drop leaving the folders keeps the
 * lifetime it lived by, from now, so it doesn't expire on the spot.
 */
export async function moveNode(drop: DropRow, ref: string | null, who: Identity, event?: H3Event) {
  const target = ref ? await requireFolder(ref, who, event, drop) : null
  if ((target?.id ?? null) === drop.parentId) return
  const now = Date.now()
  const own = drop.raw ?? drop
  const slug = await uniqueSlug(target?.id ?? null, own.slug ?? slugify(own.title), own.link)
  const life = target ? {} : { lifetime: drop.lifetime, keepReason: drop.keepReason, lastAccessedAt: now }
  await db.update(drops).set({ parentId: target?.id ?? null, slug, ...life }).where(sql`${drops.id} IN (${chainOf(drop)})`)
  if (target) await touchFolder(target.id, now)
}
