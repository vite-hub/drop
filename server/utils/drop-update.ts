import { eq } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import type * as v from "valibot"
import { db } from "vite-hub/database"
import type { DropPatchSchema } from "#shared/schemas"
import { isPublic, type Share } from "#shared/share"
import { slugify } from "#shared/links"
import { drops } from "../databases/default/index"
import { type DropRow, findDrop, lifetimeFields, permissions, restoreDrop, toSummary, trashDrop } from "./drops"
import { expiryPolicy, renewDrop } from "./expiry"
import { MAX_FOLDER_DESCRIPTION, moveNode } from "./folders"
import type { Identity } from "./identity"
import { logDrop } from "./logs"
import { linkAddress } from "./link-items"
import { isAttachment, itemCounts, parentNode, resolveNode, rootOf, uniqueSlug } from "./nodes"
import { requireKeepSlot } from "./quotas"
import { modeFor, shareFields } from "./share"
import { shareReviewFor } from "./trust"

export type DropChange = v.InferOutput<typeof DropPatchSchema>

export async function updateDrop(found: DropRow, who: Identity, body: DropChange, event?: H3Event) {
  const can = permissions(found, who)
  const onlyTrash = body.trashed === true && Object.keys(body).length === 1
  if (isAttachment(found) || !(can.manage || (onlyTrash && can.trash)))
    throw new HTTPError({ status: 404, statusText: "No drop with that id." })
  if (body.trashed !== undefined && !can.owner && who.role !== "admin" && !(onlyTrash && can.trash))
    throw new HTTPError({ status: 403, statusText: "Only the drop's owner can move it to the Trash or restore it." })
  const described = found.kind === "folder" || found.kind === "link"
  if (body.description !== undefined && (!described || (found.teamFolder && who.actorKind !== "browser")))
    throw new HTTPError({
      status: 400,
      statusText: described
        ? "People describe team folders, in the browser."
        : "Only folders and links have a description.",
    })
  if (body.url !== undefined && found.kind !== "link")
    throw new HTTPError({ status: 400, statusText: "Only links have an address to change." })
  const { days } = expiryPolicy(event)
  const now = Date.now()
  let drop = found
  if (body.trashed === false && drop.expired) {
    const above = parentNode(drop, days)
    if (above?.expired)
      throw new HTTPError({
        status: 409,
        message: `It's in ${trashedFolder(drop, days).title}, which is in the Trash. Restore that folder.`,
      })
    await restoreDrop(drop, now)
    drop = { ...drop, trashedAt: null, trashReason: null, lastAccessedAt: now, expired: false }
  } else if (drop.expired && Object.keys(body).some((key) => key !== "trashed"))
    throw new HTTPError({ status: 409, statusText: "This drop is in the Trash. Restore it first." })
  if (body.folder !== undefined) {
    await moveNode(drop, body.folder || null, who, event)
    drop = (await findDrop(drop.id, event)) ?? drop
  }
  if (body.lifetime !== undefined && drop.teamFolder)
    throw new HTTPError({ status: 400, statusText: "A team folder never expires." })
  if (body.lifetime !== undefined && drop.parentId)
    throw new HTTPError({
      status: 400,
      statusText: "It lives as long as its folder. Change the folder's lifetime, or move it out first.",
    })
  const own = drop.raw ?? drop
  const share: { share?: Share; publicUntil?: number | null; shareReview?: "pending" | "rejected" | null } = {}
  if (body.share !== undefined && (body.share !== own.share || isPublic(body.share))) {
    Object.assign(share, shareFields(body.share, { ...drop, team: modeFor(drop, event) === "team" }, event, now))
    if (isPublic(body.share) !== isPublic(own.share))
      share.shareReview = isPublic(body.share) ? await shareReviewFor(drop.ownerId, event) : null
  }
  const title = {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined
      ? { note: body.description.trim().slice(0, MAX_FOLDER_DESCRIPTION) || null }
      : {}),
    ...(body.url !== undefined ? { siteUrl: linkAddress(body.url) } : {}),
  }
  const life =
    body.lifetime !== undefined
      ? lifetimeFields(who, { lifetime: body.lifetime, keepReason: body.keepReason }, drop, event)
      : {}
  if (body.lifetime !== undefined)
    await requireKeepSlot(drop.ownerId, { lifetime: body.lifetime }, drop.lifetime === "keep", !drop.parentId)
  const slug = body.slug !== undefined ? { slug: await uniqueSlug(drop.parentId, slugify(body.slug), own.id) } : {}
  const change = { ...share, ...life, ...slug, ...title }
  if (Object.keys(change).length) await db.update(drops).set(change).where(eq(drops.id, drop.id))
  const renewed = body.renew || body.lifetime ? { lastAccessedAt: now } : {}
  if (renewed.lastAccessedAt) await renewDrop(rootOf(drop), now)
  if (body.trashed === true && !drop.expired) await trashDrop(drop, now)
  const trashed =
    body.trashed === true
      ? { trashedAt: drop.trashedAt ?? now, trashReason: drop.trashReason ?? ("deleted" as const), expired: true }
      : {}
  if (drop.parentId && Object.keys(share).length) drop = (await findDrop(drop.id, event)) ?? drop
  else drop = { ...drop, ...change, raw: { ...own, ...change } }
  const fields = Object.keys(body)
  const only = fields.length === 1 && body.trashed !== undefined
  logDrop(event, drop, { change: only ? (body.trashed ? "trash" : "restore") : "update", fields })
  const summary = toSummary({ ...drop, ...title, ...renewed, ...trashed }, undefined, days)
  return drop.kind === "folder" ? { ...summary, items: (await itemCounts([drop.id])).get(drop.id) ?? 0 } : summary
}

function trashedFolder(drop: DropRow, days: number) {
  const above = drop.ancestors ?? []
  for (let index = above.length - 1; index >= 0; index--)
    if (resolveNode(above[index]!, above.slice(index + 1), days).expired) return above[index]!
  return above[0]!
}
