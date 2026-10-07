import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm"
import { log } from "evlog"
import { HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { db } from "vite-hub/database/drizzle"
import { blobCleanup, dropFiles, drops } from "../databases/config"
import { kv } from "vite-hub/kv"
import { kindFromFilename, titleFromSource } from "#shared/plans"
import { renderMarkdownCached } from "./markdown-document"
import { contentTypeOf } from "#shared/project-bundle"
import { ACCESS_RANK, type Access, type DropDetail, type DropSummary, type DropVersion } from "#shared/types"
import type { Identity } from "./identity"

export type DropRow = typeof drops.$inferSelect

import { MAX_FILE_BYTES } from "#shared/schemas"

export { MAX_FILE_BYTES }
export const MAX_APP_FILES = 200
const TEXT_KINDS = new Set(["markdown", "html"])

/** What the caller may do with a drop. Editors and admins act on every drop in the workspace. */
export function permissions(drop: DropRow, who: Identity | null) {
  const owner = Boolean(who && who.userId === drop.ownerId)
  const staff = Boolean(who && (who.role === "admin" || who.role === "editor"))
  const shared = drop.visibility === "shared"
  const level = ACCESS_RANK[drop.access as Access]
  return {
    owner,
    view: owner || staff || shared,
    comment: owner || staff || (shared && level >= ACCESS_RANK.comment),
    edit: owner || staff || (shared && level >= ACCESS_RANK.edit),
    manage: owner || staff,
  }
}

export function toSummary(row: DropRow, paths?: string[]): DropSummary {
  return {
    id: row.id, kind: row.kind, title: row.title, filename: row.filename, size: row.size, version: row.version,
    visibility: row.visibility, access: row.access as Access, actorKind: row.actorKind, actorName: row.actorName,
    createdAt: row.createdAt, updatedAt: row.updatedAt, ...(paths ? { paths } : {}),
  }
}

export async function findDrop(id: string) {
  const [row] = await db.select().from(drops).where(eq(drops.id, id)).limit(1)
  return row ?? null
}

/** Your drops, newest first. Older versions of a doc hide behind their latest. */
export async function listDrops(who: Identity): Promise<DropSummary[]> {
  const rows = await db.select().from(drops).where(eq(drops.ownerId, who.userId)).orderBy(desc(drops.updatedAt)).limit(500)
  const superseded = new Set(rows.map(row => row.supersedesId).filter(Boolean))
  const apps = rows.filter(row => row.kind === "app").map(row => row.id)
  const files = apps.length ? await db.select({ dropId: dropFiles.dropId, path: dropFiles.path }).from(dropFiles).where(inArray(dropFiles.dropId, apps)) : []
  const pathsOf = (id: string) => files.filter(file => file.dropId === id).map(file => file.path).sort()
  return rows.filter(row => !superseded.has(row.id)).map(row => toSummary(row, row.kind === "app" ? pathsOf(row.id) : undefined))
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
  // Versions always share an owner, so one query loads every candidate and the chain is walked in memory.
  const docs = await db.select().from(drops).where(eq(drops.ownerId, row.ownerId))
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
    if (TEXT_KINDS.has(row.kind)) detail.content = await readText(row.blobKey)
    if (row.kind === "markdown") detail.html = (await renderMarkdownCached(row.blobKey, detail.content ?? "")).html
    detail.url = new URL(`/f/${row.blobKey}?raw`, origin).href
  }
  return detail
}

async function bumpUploadCount() {
  const [readError, uploads] = await kv.get<number>("stats:uploads")
  if (readError) return
  await kv.set("stats:uploads", (uploads ?? 0) + 1)
}

async function queueBlobCleanup(keys: string[]) {
  const unique = [...new Set(keys)]
  if (!unique.length) return
  try {
    await db.insert(blobCleanup).values(unique.map(blobKey => ({ id: crypto.randomUUID(), blobKey, createdAt: Date.now() }))).onConflictDoNothing()
  }
  catch (error) {
    log.error({ action: "blob-cleanup-queue", error: String(error) })
  }
}

/** Retries cleanup left by an earlier metadata operation. */
async function drainBlobCleanup() {
  const pending = await db.select().from(blobCleanup).limit(20)
  for (const item of pending) {
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
  const [error] = await blob.del(unique)
  if (error) {
    log.error({ action: "blob-cleanup", error: error.message, keys: unique.length })
    await queueBlobCleanup(unique)
    return
  }
  await db.delete(blobCleanup).where(inArray(blobCleanup.blobKey, unique))
}

/** Stores one file as a private doc drop. Markdown and HTML must be UTF-8. */
export async function createDocDrop(who: Identity, input: { filename: string; bytes: Uint8Array; title?: string; supersedes?: string; visibility?: "private" | "shared"; access?: Access }) {
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
    previous = await findDrop(supersedes) ?? (await db.select().from(drops).where(and(isNotNull(drops.blobKey), eq(drops.blobKey, supersedes))).limit(1))[0] ?? null
    if (previous && !permissions(previous, who).edit) previous = null
    if (previous) previous = (await versionChain(previous))[0] ?? previous
  }

  const key = `${crypto.randomUUID()}${extension}`
  const [storageError] = await blob.put(key, input.bytes, { access: "private", contentType })
  if (storageError) {
    const [cleanupError] = await blob.del(key)
    if (cleanupError) await queueBlobCleanup([key])
    throw storageFailure(storageError)
  }

  // Renders once at upload: the title comes from Comark, and the first view hits a warm cache.
  let parsedTitle: string | undefined
  try {
    parsedTitle = kind === "markdown" && text ? (await renderMarkdownCached(key, text)).title : undefined
  }
  catch (error) {
    const [cleanupError] = await blob.del(key)
    if (cleanupError) await queueBlobCleanup([key])
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
  }
  try {
    await db.insert(drops).values(row)
  }
  catch (error) {
    const [cleanupError] = await blob.del(key)
    if (cleanupError) await queueBlobCleanup([key])
    if (previous && /unique|constraint/i.test(String(error)))
      throw new HTTPError({ status: 409, statusText: "This drop was published by someone else. Retry from the latest version.", cause: error })
    throw error
  }
  await bumpUploadCount()
  return row
}

function cleanPath(path: string) {
  const clean = path.replace(/\\/g, "/").replace(/^\/+/, "").split("/").filter(part => part && part !== "." && part !== "..").join("/")
  if (!clean || clean.length > 300) throw new HTTPError({ status: 400, statusText: `Invalid file path: ${path}` })
  return clean
}

/** Creates an app drop, or publishes the next version of one you may edit. */
export async function publishApp(who: Identity, input: { id?: string; name?: string; files: Record<string, string> }) {
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
  let row = input.id ? await findDrop(input.id) : null
  if (input.id && (!row || row.kind !== "app")) throw new HTTPError({ status: 404, statusText: "No app with that id." })
  if (row && !permissions(row, who).edit) throw new HTTPError({ status: 403, statusText: "You can't edit this app." })
  if (row) row = (await versionChain(row))[0] ?? row

  const id = row?.id ?? crypto.randomUUID()
  const prefix = `apps/${id}/${crypto.randomUUID()}`
  const token = crypto.randomUUID()
  const old = row ? await db.select().from(dropFiles).where(eq(dropFiles.dropId, id)) : []
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
      visibility: row?.visibility ?? "private", access: (row?.access as Access | undefined) ?? "comment",
      actorKind: who.actorKind, actorName: who.actorName, createdAt: row?.createdAt ?? now, updatedAt: now, publishToken: token,
    }
    const fileRows = encoded.map(([path, bytes]) => ({ dropId: id, path, blobKey: `${prefix}/${path}`, size: bytes.byteLength }))
    if (!row) {
      await db.batch([
        db.insert(drops).values(next),
        db.insert(dropFiles).values(fileRows),
      ])
      committedPublish = true
    }
    else {
      const update = db.update(drops).set({ title: next.title, size, version: next.version, actorKind: next.actorKind, actorName: next.actorName, updatedAt: now, publishToken: token })
        .where(and(eq(drops.id, id), eq(drops.version, row.version)))
      const replace = db.run(sql`DELETE FROM drop_files WHERE drop_id = ${id} AND EXISTS (SELECT 1 FROM drops WHERE id = ${id} AND publish_token = ${token})`)
      const inserts = encoded.map(([path, bytes]) => db.run(sql`INSERT INTO drop_files (drop_id, path, blob_key, size) SELECT ${id}, ${path}, ${`${prefix}/${path}`}, ${bytes.byteLength} WHERE EXISTS (SELECT 1 FROM drops WHERE id = ${id} AND publish_token = ${token})`))
      await db.batch([update, replace, ...inserts])
      committedPublish = true
      const [committed] = await db.select({ publishToken: drops.publishToken }).from(drops).where(eq(drops.id, id)).limit(1)
      if (committed?.publishToken !== token) {
        committedPublish = false
        throw new HTTPError({ status: 409, statusText: "This app was published by someone else. Retry from the latest version." })
      }
      await deleteBlobKeys(old.map(file => file.blobKey))
    }
    return next
  }
  catch (error) {
    if (!committedPublish) {
      const [cleanupError] = stagedKeys.length ? await blob.del(stagedKeys) : [null]
      if (cleanupError) await queueBlobCleanup(stagedKeys)
    }
    const status = typeof error === "object" && error ? (error as { status?: unknown }).status : undefined
    if (row && status !== 503 && /unique|constraint/i.test(String(error)))
      throw new HTTPError({ status: 409, statusText: "This app was published by someone else. Retry from the latest version.", cause: error })
    throw error
  }
}

/** Removes a drop, its files, and its comments. */
export async function deleteDrop(row: DropRow) {
  await drainBlobCleanup()
  const chain = await versionChain(row)
  const files = chain.some(item => item.kind === "app")
    ? await db.select().from(dropFiles).where(inArray(dropFiles.dropId, chain.map(item => item.id)))
    : []
  const keys = [...files.map(file => file.blobKey), ...chain.map(item => item.blobKey).filter((key): key is string => Boolean(key))]
  const cleanupRows = [...new Set(keys)].map(blobKey => ({ id: crypto.randomUUID(), blobKey, createdAt: Date.now() }))
  const deleteRows = db.delete(drops).where(inArray(drops.id, chain.map(item => item.id)))
  if (cleanupRows.length)
    await db.batch([db.insert(blobCleanup).values(cleanupRows).onConflictDoNothing(), deleteRows])
  else
    await deleteRows
  await deleteBlobKeys(keys)
}

export const dropPageUrl = (origin: string, id: string) => new URL(`/d/${id}`, origin).href
