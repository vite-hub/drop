import { eq, sql } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import type * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import type { DropPatchSchema } from "#shared/schemas"
import type { Access, Visibility } from "#shared/types"
import { slugify } from "#shared/links"
import { drops } from "../databases/config"
import { type DropRow, findDrop, lifetimeFields, permissions, restoreDrop, toSummary, trashDrop } from "./drops"
import { chainOf, expiryPolicy, renewDrop } from "./expiry"
import { moveNode } from "./folders"
import type { Identity } from "./identity"
import { isAttachment, parentNode, resolveNode, rootOf, uniqueSlug } from "./nodes"
import { shareReviewFor } from "./trust"

export type DropChange = v.InferOutput<typeof DropPatchSchema>

/** How agents say who can open a drop: private, or the team or anyone with the link at one access level. */
export type Share = "private" | Access
export type Audience = "team" | "link"
/** Without an audience, a drop keeps the one it has, and a private drop gets a link. */
export const shareChange = (share: Share, audience?: Audience, current?: Visibility): Pick<DropChange, "visibility" | "access"> =>
  share === "private" ? { visibility: "private" } : { visibility: (audience ?? (current === "team" ? "team" : "link")) === "team" ? "team" : "shared", access: share }

/**
 * Share, unshare, change the link's access level, rename, rename the link, change the lifetime, renew, trash, restore, or
 * move into a folder. People (PATCH /api/drops/:id) and agents (MCP) go through here, so both follow the same rules.
 * A drop in a folder changes its own share (the folder's may still reach wider) and lives as long as the folder.
 */
export async function updateDrop(found: DropRow, who: Identity, body: DropChange, event?: H3Event) {
  // Attachments follow their doc; change the doc instead.
  if (isAttachment(found) || !permissions(found, who).manage) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  if (body.trashed !== undefined && !permissions(found, who).owner && who.role !== "admin")
    throw new HTTPError({ status: 403, statusText: "Only the drop's owner can move it to the Trash or restore it." })
  const { days } = expiryPolicy(event)
  const now = Date.now()
  let drop = found
  if (body.trashed === false && drop.expired) {
    // A drop inside a folder in the Trash comes back with the folder.
    const above = parentNode(drop, days)
    if (above?.expired) throw new HTTPError({ status: 409, statusText: `It's in ${trashedFolder(drop, days).title}, which is in the Trash. Restore that folder.` })
    await restoreDrop(drop, now)
    drop = { ...drop, trashedAt: null, trashReason: null, lastAccessedAt: now, expired: false }
  }
  else if (drop.expired && Object.keys(body).some(key => key !== "trashed"))
    throw new HTTPError({ status: 409, statusText: "This drop is in the Trash. Restore it first." })
  // Moving comes first: the slug below must be unique in the folder it ends up in.
  if (body.folder !== undefined) {
    await moveNode(drop, body.folder || null, who, event)
    drop = (await findDrop(drop.id, event)) ?? drop
  }
  if (body.lifetime !== undefined && drop.parentId)
    throw new HTTPError({ status: 400, statusText: "It lives as long as its folder. Change the folder's lifetime, or move it out first." })
  const own = drop.raw ?? drop
  const share: { shareReview?: "pending" | "rejected" | null; visibility?: Visibility; access?: Access } = {}
  if (body.visibility !== undefined && body.visibility !== own.visibility) {
    share.visibility = body.visibility
    share.shareReview = body.visibility === "private" ? null : await shareReviewFor(drop.ownerId, event)
  }
  if (body.access !== undefined) share.access = body.access
  const title = typeof body.title === "string" ? { title: body.title } : {}
  const life = body.lifetime !== undefined ? lifetimeFields(who, { lifetime: body.lifetime, keepReason: body.keepReason }, drop, event) : {}
  const slug = body.slug !== undefined ? { slug: await uniqueSlug(drop.parentId, slugify(body.slug), own.link) } : {}
  const chainChange = { ...share, ...life, ...slug }
  if (Object.keys(chainChange).length) {
    // A link, its name and its lifetime belong to the document chain, so every version carries the same state.
    await db.update(drops).set(chainChange).where(sql`${drops.id} IN (${chainOf(drop)})`)
  }
  if (Object.keys(title).length) await db.update(drops).set(title).where(eq(drops.id, drop.id))
  // Choosing a lifetime starts its window now, so turning a kept drop temporary doesn't expire it on the spot. A drop
  // in a folder renews the folder at the top, whose window it lives by.
  const renewed = body.renew || body.lifetime ? { lastAccessedAt: now } : {}
  if (renewed.lastAccessedAt) await renewDrop(rootOf(drop), now)
  if (body.trashed === true && !drop.expired) await trashDrop(drop, now)
  const trashed = body.trashed === true ? { trashedAt: drop.trashedAt ?? now, trashReason: drop.trashReason ?? "deleted" as const, expired: true } : {}
  // In a folder, the share it ends up with depends on the folders above: read it back.
  if (drop.parentId && Object.keys(share).length) drop = (await findDrop(drop.id, event)) ?? drop
  else drop = { ...drop, ...chainChange, raw: { ...own, ...chainChange } }
  return toSummary({ ...drop, ...title, ...renewed, ...trashed }, undefined, days)
}

/** The top-most node above a drop that is in the Trash, or expired into it: restoring that one brings the drop back. */
function trashedFolder(drop: DropRow, days: number) {
  const above = drop.ancestors ?? []
  for (let index = above.length - 1; index >= 0; index--)
    if (resolveNode(above[index]!, above.slice(index + 1), days).expired) return above[index]!
  return above[0]!
}
