import { eq, inArray } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import type * as v from "valibot"
import { db } from "vite-hub/database/drizzle"
import type { DropPatchSchema } from "#shared/schemas"
import type { Access } from "#shared/types"
import { drops } from "../databases/config"
import { type DropRow, lifetimeFields, permissions, restoreDrop, toSummary, trashDrop, versionChain } from "./drops"
import { expiryPolicy, renewDrop } from "./expiry"
import type { Identity } from "./identity"
import { shareReviewFor } from "./trust"

export type DropChange = v.InferOutput<typeof DropPatchSchema>

/** How agents say who can open a drop: private, or a shared link at one access level. */
export type Share = "private" | Access
export const shareChange = (share: Share): Pick<DropChange, "visibility" | "access"> => share === "private" ? { visibility: "private" } : { visibility: "shared", access: share }

/**
 * Share, unshare, change the link's access level, rename, change the lifetime, renew, trash, or restore. People
 * (PATCH /api/drops/:id) and agents (MCP) go through here, so both follow the same rules.
 */
export async function updateDrop(found: DropRow, who: Identity, body: DropChange, event?: H3Event) {
  // Attachments follow their doc; change the doc instead.
  if (found.parentId || !permissions(found, who).manage) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  if (body.trashed !== undefined && !permissions(found, who).owner && who.role !== "admin")
    throw new HTTPError({ status: 403, statusText: "Only the drop's owner can move it to the Trash or restore it." })
  const now = Date.now()
  let drop = found
  if (body.trashed === false && drop.expired) {
    await restoreDrop(drop, now)
    drop = { ...drop, trashedAt: null, trashReason: null, lastAccessedAt: now, expired: false }
  }
  else if (drop.expired && Object.keys(body).some(key => key !== "trashed"))
    throw new HTTPError({ status: 409, statusText: "This drop is in the Trash. Restore it first." })
  const share: { shareReview?: "pending" | "rejected" | null; visibility?: "private" | "shared"; access?: Access } = {}
  if (body.visibility !== undefined && body.visibility !== drop.visibility) {
    share.visibility = body.visibility
    share.shareReview = body.visibility === "shared" ? await shareReviewFor(drop.ownerId, event) : null
  }
  if (body.access !== undefined) share.access = body.access
  const title = typeof body.title === "string" ? { title: body.title } : {}
  const life = body.lifetime !== undefined ? lifetimeFields(who, { lifetime: body.lifetime, keepReason: body.keepReason }, drop, event) : {}
  const chainChange = { ...share, ...life }
  if (Object.keys(chainChange).length) {
    // A link and its lifetime belong to the document chain, so every version carries the same state.
    const ids = (await versionChain(drop)).map(item => item.id)
    await db.update(drops).set(chainChange).where(inArray(drops.id, ids))
  }
  if (Object.keys(title).length) await db.update(drops).set(title).where(eq(drops.id, drop.id))
  // Choosing a lifetime starts its window now, so turning a kept drop temporary doesn't expire it on the spot.
  const renewed = body.renew || body.lifetime ? { lastAccessedAt: now } : {}
  if (renewed.lastAccessedAt) await renewDrop(drop, now)
  if (body.trashed === true && !drop.expired) await trashDrop(drop, now)
  const trashed = body.trashed === true ? { trashedAt: drop.trashedAt ?? now, trashReason: drop.trashReason ?? "deleted" as const, expired: true } : {}
  return toSummary({ ...drop, ...chainChange, ...title, ...renewed, ...trashed }, undefined, expiryPolicy(event).days)
}
