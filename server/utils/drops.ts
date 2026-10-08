import { and, desc, eq, exists, inArray, sql } from "drizzle-orm"
import { log } from "evlog"
import { type H3Event, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { db } from "vite-hub/database/drizzle"
import { blobCleanup, dropFiles, dropHeads, drops, user } from "../databases/config"
import { kindFromFilename, titleFromSource } from "#shared/plans"
import { renderMarkdownCached } from "./markdown-document"
import { deleteMarkdownCache } from "./markdown-cache"
import { contentTypeOf } from "#shared/project-bundle"
import { ACCESS_RANK, type Access, type DropDetail, type DropSummary, type DropVersion } from "#shared/types"
import { shareReviewFor } from "./trust"
import type { Identity } from "./identity"
import { withDropQuota } from "./quotas"
import { deleteRetainedDrop } from "./quota-deletion"

export type DropRow = typeof drops.$inferSelect & { ownerBanned?: boolean }

import { MAX_FILE_BYTES } from "#shared/schemas"
import { MAX_APP_FILES } from "#shared/quotas"

export { MAX_FILE_BYTES }
export { MAX_APP_FILES }
const TEXT_KINDS = new Set(["markdown", "html"])

/** What the caller may do with a drop. Editors and admins act on every drop in the workspace. */
export function permissions(drop: DropRow, who: Identity | null) {
  if (drop.quarantinedAt) return { owner: false, view: false, comment: false, edit: false, manage: Boolean(who && (who.userId === drop.ownerId || who.role === "admin")) }
  const owner = Boolean(who && who.userId === drop.ownerId)
  const staff = Boolean(who && (who.role === "admin" || who.role === "editor"))
  const shared = drop.visibility === "shared" && !drop.shareReview
  const level = ACCESS_RANK[drop.access as Access]
  const available = !drop.ownerBanned
  return {
    owner,
    view: available && (owner || staff || shared),
    comment: available && (owner || staff || (shared && level >= ACCESS_RANK.comment)),
    edit: available && (owner || staff || (shared && level >= ACCESS_RANK.edit)),
    manage: owner || staff,
  }
}

export function toSummary(row: DropRow, paths?: string[]): DropSummary {
  return {
    id: row.id, kind: row.kind, title: row.title, filename: row.filename, size: row.size, version: row.version,
    shareReview: row.shareReview, quarantinedAt: row.quarantinedAt, visibility: row.visibility, access: row.access as Access, actorKind: row.actorKind, actorName: row.actorName,
    createdAt: row.createdAt, updatedAt: row.updatedAt, ...(paths ? { paths } : {}),
  }
}

/** Reuse the joined owner for review policy so each lookup remains one query. */
async function withOwnerAccess(row: { drop: typeof drops.$inferSelect; owner: typeof user.$inferSelect | null } | undefined, event?: H3Event): Promise<DropRow | null> {
  if (!row) return null
  const drop = { ...row.drop, ownerBanned: !row.owner || Boolean(row.owner.banned) }
  if (event && drop.shareReview && await shareReviewFor(drop.ownerId, event, row.owner) === null) drop.shareReview = null
  return drop
}

export async function findDrop(id: string, event?: H3Event) {
  const [row] = await db.select({ drop: drops, owner: user }).from(drops)
    .leftJoin(user, eq(user.id, drops.ownerId)).where(eq(drops.id, id)).limit(1)
  return withOwnerAccess(row, event)
}

export async function findDropByBlob(key: string, event?: H3Event) {
  const [row] = await db.select({ drop: drops, owner: user }).from(drops)
    .leftJoin(user, eq(user.id, drops.ownerId)).where(eq(drops.blobKey, key)).limit(1)
  return withOwnerAccess(row, event)
}

/** Your drops, newest first. Older versions of a doc hide behind their latest. */
export async function listDrops(who: Identity): Promise<DropSummary[]> {
  const rows = (await db.select({ drop: drops }).from(dropHeads).innerJoin(drops, eq(drops.id, dropHeads.dropId))
    .where(eq(dropHeads.ownerId, who.userId)).orderBy(desc(dropHeads.updatedAt)).limit(500)).map(row => row.drop)
  const apps = rows.filter(row => row.kind === "app").map(row => row.id)
  const files = apps.length ? await db.select({ dropId: dropFiles.dropId, path: dropFiles.path }).from(dropFiles).where(inArray(dropFiles.dropId, apps)) : []
  const pathsOf = (id: string) => files.filter(file => file.dropId === id).map(file => file.path).sort()
  return rows.map(row => toSummary(row, row.kind === "app" ? pathsOf(row.id) : undefined))
}

function storageFailure(error: Error) {
  log.error({ action: "storage", error: error.message, cause: String((error as { cause?: unknown }).cause ?? "") })
  return new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable.", cause: error })
}

async function readText(key: string) {
  const [error, file] = await blob.get(key)
  if (error) throw storageFailure(error)
  if (!file) throw new HTTPError({ status: 404, statusText: "File content is missing." })
  return await file.text()
}

export async function versionChain(row: DropRow) {
  // Follow indexed parent/child links, retaining the existing 50 older / 100 total view bounds.
  const docs = await db.select().from(drops).where(inArray(drops.id, sql`(
    WITH RECURSIVE
    older(id, supersedes_id, depth) AS (
      SELECT id, supersedes_id, 0 FROM drops WHERE id = ${row.id} AND owner_id = ${row.ownerId}
      UNION ALL
      SELECT d.id, d.supersedes_id, o.depth + 1 FROM drops d JOIN older o ON d.id = o.supersedes_id
      WHERE d.owner_id = ${row.ownerId} AND o.depth < 49
    ),
    newer(id, depth) AS (
      SELECT id, 0 FROM drops WHERE id = ${row.id} AND owner_id = ${row.ownerId}
      UNION ALL
      SELECT d.id, n.depth + 1 FROM drops d JOIN newer n ON d.supersedes_id = n.id
      WHERE d.owner_id = ${row.ownerId} AND n.depth < 99
    )
    SELECT id FROM older UNION SELECT id FROM newer
  )
  `))
  const byId = new Map(docs.map(doc => [doc.id, doc]))
  const next = new Map(docs.filter(doc => doc.supersedesId).map(doc => [doc.supersedesId!, doc]))
  const chain = [byId.get(row.id) ?? row]
  for (let older = chain[0]!.supersedesId; older && byId.has(older) && chain.length < 50; older = byId.get(older)!.supersedesId) chain.push(byId.get(older)!)
  for (let newer = next.get(row.id); newer && chain.length < 100; newer = next.get(newer.id)) chain.unshift(newer)
  return chain
}

/** The version chain, newest first. */
async function versionsOf(row: DropRow): Promise<DropVersion[]> {
  return (await versionChain(row)).map(item => ({ id: item.id, title: item.title, version: item.version, createdAt: item.createdAt, current: item.id === row.id }))
}

export async function dropDetail(row: DropRow, who: Identity | null, origin: string): Promise<DropDetail> {
  const can = permissions(row, who)
  if (!can.view) throw new HTTPError({ status: 404, statusText: "Not found" })
  const detail: DropDetail = {
    ...toSummary(row),
    isOwner: can.manage,
    canComment: can.comment,
    canEdit: can.edit && (row.kind === "app" || TEXT_KINDS.has(row.kind)),
    versions: await versionsOf(row),
  }
  if (row.kind === "app") {
    const files = await db.select().from(dropFiles).where(eq(dropFiles.dropId, row.id))
    detail.files = Object.fromEntries(await Promise.all(files.map(async file => [file.path, await readText(file.blobKey)] as const)))
    detail.paths = files.map(file => file.path).sort()
  }
  else if (row.blobKey) {
    if (row.kind === "markdown") {
      const rendered = await renderMarkdownCached(row.blobKey, () => readText(row.blobKey!))
      detail.content = rendered.source
      detail.html = rendered.html
    }
    else if (TEXT_KINDS.has(row.kind)) detail.content = await readText(row.blobKey)
    detail.url = new URL(`/f/${row.blobKey}?raw`, origin).href
  }
  return detail
}

async function queueBlobCleanup(keys: string[]) {
  const unique = [...new Set(keys)]
  if (!unique.length) return
  try {
    for (let offset = 0; offset < unique.length; offset += 25)
      await db.insert(blobCleanup).values(unique.slice(offset, offset + 25).map(blobKey => ({ id: crypto.randomUUID(), blobKey, createdAt: Date.now() }))).onConflictDoNothing()
  }
  catch (error) {
    log.error({ action: "blob-cleanup-queue", error: String(error) })
  }
}

/** Retries cleanup left by an earlier metadata operation. */
async function drainBlobCleanup() {
  const pending = await db.select().from(blobCleanup).limit(20)
  for (const item of pending) {
    try {
      await deleteMarkdownCache(item.blobKey)
    }
    catch { continue }
    const [error] = await blob.del(item.blobKey)
    if (error) continue
    await db.delete(blobCleanup).where(eq(blobCleanup.id, item.id))
  }
}

/**
 * Deletes blobs whose metadata is already gone. A failure doesn't fail the request (the publish or delete already
 * happened): the keys stay queued and the next drop operation retries them.
 */
async function deleteBlobKeys(keys: string[]) {
  const unique = [...new Set(keys)]
  if (!unique.length) return
  try {
    await Promise.all(unique.map(deleteMarkdownCache))
  }
  catch (error) {
    log.error({ action: "markdown-cache-cleanup", error: String(error) })
    await queueBlobCleanup(unique)
    return
  }
  const [error] = await blob.del(unique)
  if (error) {
    log.error({ action: "blob-cleanup", error: error.message, keys: unique.length })
    await queueBlobCleanup(unique)
    return
  }
  for (let offset = 0; offset < unique.length; offset += 80)
    await db.delete(blobCleanup).where(inArray(blobCleanup.blobKey, unique.slice(offset, offset + 80)))
}

/** Stores one file as a private doc drop. Markdown and HTML must be UTF-8. */
export async function createDocDrop(who: Identity, input: { filename: string; bytes: Uint8Array; title?: string; supersedes?: string; visibility?: "private" | "shared"; access?: Access }, event?: H3Event) {
  await drainBlobCleanup()
  if (input.bytes.byteLength > MAX_FILE_BYTES) throw new HTTPError({ status: 413, statusText: "The file exceeds the 4 MiB limit." })
  const filename = input.filename.replace(/[/\\]/g, "-").slice(0, 200) || "drop"
  const extension = filename.match(/\.[a-z0-9]{1,16}$/i)?.[0].toLowerCase() ?? ""
  let kind = kindFromFilename(filename)
  let contentType = detectContentType(input.bytes) ?? "application/octet-stream"
  let text: string | undefined
  if ([".md", ".markdown", ".html", ".htm", ".txt"].includes(extension)) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes)
    }
    catch {
      throw new HTTPError({ status: 400, statusText: `${extension === ".html" ? "HTML" : "Markdown"} files must contain valid UTF-8.` })
    }
    contentType = kind === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8"
  }
  if (kind === "file" && contentType.startsWith("image/")) kind = "image"

  let previous: DropRow | null = null
  const supersedes = input.supersedes ?? (text ? text.match(/^---\n[\s\S]*?^supersedes:\s*["']?(?:\S*\/)?([0-9a-f-]{36})(?:\.\w+)?["']?\s*$/m)?.[1] : undefined)
  if (supersedes) {
    previous = await findDrop(supersedes) ?? await findDropByBlob(supersedes)
    if (previous && !permissions(previous, who).edit) previous = null
    if (previous) previous = (await versionChain(previous))[0] ?? previous
  }

  return withDropQuota(previous?.ownerId ?? who.userId, { drops: previous ? 0 : 1, bytes: input.bytes.byteLength, writes: 1, targetId: previous?.id }, event, async (quota) => {
    const key = `${crypto.randomUUID()}${extension}`
    const [storageError] = await blob.put(key, input.bytes, { access: "private", contentType })
    if (storageError) {
      await deleteBlobKeys([key])
      throw storageFailure(storageError)
    }

    // Renders once at upload: the title comes from Comark, and the first view hits a warm cache.
    let parsedTitle: string | undefined
    try {
      parsedTitle = kind === "markdown" && text ? (await renderMarkdownCached(key, text)).title : undefined
    }
    catch (error) {
      await deleteBlobKeys([key])
      throw error
    }
    const markdownTitle = parsedTitle === "Untitled document" ? undefined : parsedTitle
    const now = Date.now()
    const row: DropRow = {
      id: crypto.randomUUID(),
      ownerId: previous?.ownerId ?? who.userId,
      kind,
      title: (input.title?.trim() || markdownTitle || titleFromSource(text ?? "", kind, filename)).slice(0, 160),
      filename,
      blobKey: key,
      contentType,
      size: input.bytes.byteLength,
      version: (previous?.version ?? 0) + 1,
      supersedesId: previous?.id ?? null,
      visibility: input.visibility ?? previous?.visibility ?? "private",
      access: input.access ?? (previous?.access as Access | undefined) ?? "comment",
      actorKind: who.actorKind,
      actorName: who.actorName,
      createdAt: now,
      updatedAt: now,
      shareReview: (input.visibility ?? previous?.visibility) === "shared" ? await shareReviewFor(previous?.ownerId ?? who.userId, event) : null,
      quarantinedAt: null,
      publishToken: null,
    }
    try {
      await quota.commit([db.insert(drops).values(row)], previous ? exists(db.select({ id: drops.id }).from(drops).where(eq(drops.id, previous.id))) : sql`1`)
    }
    catch (error) {
      await deleteBlobKeys([key])
      if (previous && /unique|constraint/i.test(String(error)))
        throw new HTTPError({ status: 409, statusText: "This drop was published by someone else. Retry from the latest version.", cause: error })
      throw error
    }
    return row
  })
}

function cleanPath(path: string) {
  const clean = path.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(part => part && part !== "." && part !== "..").join("/")
  if (!clean || clean.length > 300) throw new HTTPError({ status: 400, statusText: `Invalid file path: ${path}` })
  return clean
}

/** Creates an app drop, or publishes the next version of one you may edit. */
export async function publishApp(who: Identity, input: { id?: string; name?: string; files: Record<string, string> }, event?: H3Event) {
  const entries = Object.entries(input.files ?? {}).map(([path, content]) => [cleanPath(path), String(content)] as const)
  if (new Set(entries.map(([path]) => path)).size !== entries.length) throw new HTTPError({ status: 400, statusText: "An app cannot contain duplicate paths." })
  if (!entries.some(([path]) => path === "index.html")) throw new HTTPError({ status: 400, statusText: "An app needs an index.html." })
  if (entries.length > MAX_APP_FILES) throw new HTTPError({ status: 413, statusText: `An app can have at most ${MAX_APP_FILES} files.` })
  const encoder = new TextEncoder()
  const encoded = entries.map(([path, content]) => [path, encoder.encode(content)] as const)
  const size = encoded.reduce((total, [, bytes]) => total + bytes.byteLength, 0)
  if (size > MAX_FILE_BYTES) throw new HTTPError({ status: 413, statusText: "An app can be at most 4 MiB." })

  await drainBlobCleanup()
  const now = Date.now()
  let row: DropRow | null = input.id ? await findDrop(input.id) : null
  if (input.id && (!row || row.kind !== "app")) throw new HTTPError({ status: 404, statusText: "No app with that id." })
  if (row && !permissions(row, who).edit) throw new HTTPError({ status: 403, statusText: "You can't edit this app." })
  if (row) row = (await versionChain(row))[0] ?? row

  const id = row?.id ?? crypto.randomUUID()
  const prefix = `apps/${id}/${crypto.randomUUID()}`
  const token = crypto.randomUUID()
  const old = row ? await db.select().from(dropFiles).where(eq(dropFiles.dropId, id)) : []
  return withDropQuota(row?.ownerId ?? who.userId, { drops: row ? 0 : 1, bytes: Math.max(0, size - old.reduce((total, file) => total + file.size, 0)), writes: entries.length, targetId: row?.id, app: { files: entries.length, bytes: size } }, event, async (quota) => {
    const stagedKeys: string[] = []
    let committedPublish = false
    try {
      for (const [path, bytes] of encoded) {
        const blobKey = `${prefix}/${path}`
        stagedKeys.push(blobKey)
        const [error] = await blob.put(blobKey, bytes, { access: "private", contentType: contentTypeOf(path) })
        if (error) throw storageFailure(error)
      }

      const name = input.name?.trim() || row?.title || "Untitled app"
      const next: DropRow = {
        id, ownerId: row?.ownerId ?? who.userId, kind: "app", title: name.slice(0, 160),
        filename: row?.filename ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app"}/`,
        blobKey: null, contentType: null, size, version: (row?.version ?? 0) + 1, supersedesId: row?.supersedesId ?? null,
        shareReview: row?.shareReview ?? null, quarantinedAt: row?.quarantinedAt ?? null,
        visibility: row?.visibility ?? "private", access: (row?.access as Access | undefined) ?? "comment",
        actorKind: who.actorKind, actorName: who.actorName, createdAt: row?.createdAt ?? now, updatedAt: now, publishToken: token,
      }
      const fileRows = encoded.map(([path, bytes]) => ({ dropId: id, path, blobKey: `${prefix}/${path}`, size: bytes.byteLength }))
      if (!row) {
        await quota.commit([
          db.insert(drops).values(next),
          ...quota.fileInserts(fileRows),
        ])
        committedPublish = true
      }
      else {
        const update = db.update(drops).set({ title: next.title, size, version: next.version, actorKind: next.actorKind, actorName: next.actorName, updatedAt: now, publishToken: token })
          .where(and(eq(drops.id, id), eq(drops.version, row.version)))
        // The file set changes only if the update above won: both statements check for this publish's token.
        // (Builders, not raw `db.run(sql)`: D1's batch can't bind raw statements.)
        const won = and(eq(drops.id, id), eq(drops.publishToken, token))
        const replace = db.delete(dropFiles).where(and(eq(dropFiles.dropId, id), exists(db.select({ id: drops.id }).from(drops).where(won))))
        const inserts = encoded.map(([path, bytes]) => db.insert(dropFiles).select(qb => qb.select({
          dropId: drops.id,
          path: sql<string>`${path}`.as("path"),
          blobKey: sql<string>`${`${prefix}/${path}`}`.as("blob_key"),
          size: sql<number>`${bytes.byteLength}`.as("size"),
        }).from(drops).where(won)))
        await quota.commit([update, replace, ...inserts], exists(db.select({ id: drops.id }).from(drops).where(won)))
        committedPublish = true
        await deleteBlobKeys(old.map(file => file.blobKey))
      }
      return next
    }
    catch (error) {
      if (!committedPublish) {
        await deleteBlobKeys(stagedKeys)
      }
      const status = typeof error === "object" && error ? (error as { status?: unknown }).status : undefined
      if (row && status !== 503 && /unique|constraint/i.test(String(error)))
        throw new HTTPError({ status: 409, statusText: "This app was published by someone else. Retry from the latest version.", cause: error })
      throw error
    }
  })
}

/** Removes a drop, its files, and its comments. */
export async function deleteDrop(row: DropRow) {
  await drainBlobCleanup()
  await deleteRetainedDrop(row, deleteBlobKeys)
}

export const dropPageUrl = (origin: string, id: string) => new URL(`/d/${id}`, origin).href
