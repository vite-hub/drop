import { and, desc, eq, inArray, isNotNull } from "drizzle-orm"
import { HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { db } from "vite-hub/database/drizzle"
import { dropFiles, drops } from "../databases/config"
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
  console.error(JSON.stringify({ counter: "storage_failure", error: error.message, cause: String((error as { cause?: unknown }).cause ?? "") }))
  return new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable." })
}

async function readText(key: string) {
  const [error, file] = await blob.get(key)
  if (error) throw storageFailure(error)
  return file ? await file.text() : ""
}

/** The version chain of a doc, newest first. */
async function versionsOf(row: DropRow): Promise<DropVersion[]> {
  if (row.kind === "app") return [{ id: row.id, title: row.title, version: row.version, createdAt: row.updatedAt, current: true }]
  // Versions always share an owner, so one query loads every candidate and the chain is walked in memory.
  const docs = await db.select({ id: drops.id, title: drops.title, version: drops.version, createdAt: drops.createdAt, supersedesId: drops.supersedesId })
    .from(drops).where(eq(drops.ownerId, row.ownerId))
  const byId = new Map(docs.map(doc => [doc.id, doc]))
  const next = new Map(docs.filter(doc => doc.supersedesId).map(doc => [doc.supersedesId!, doc]))
  const chain = [byId.get(row.id) ?? row]
  for (let older = chain[0]!.supersedesId; older && byId.has(older) && chain.length < 50; older = byId.get(older)!.supersedesId) chain.push(byId.get(older)!)
  for (let newer = next.get(row.id); newer && chain.length < 100; newer = next.get(newer.id)) chain.unshift(newer)
  return chain.map(item => ({ id: item.id, title: item.title, version: item.version, createdAt: item.createdAt, current: item.id === row.id }))
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

/** Stores one file as a private doc drop. Markdown and HTML must be UTF-8. */
export async function createDocDrop(who: Identity, input: { filename: string; bytes: Uint8Array; title?: string; supersedes?: string; visibility?: "private" | "shared"; access?: Access }) {
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
  }

  const key = `${crypto.randomUUID()}${extension}`
  const [storageError] = await blob.put(key, input.bytes, { access: "private", contentType })
  if (storageError) throw storageFailure(storageError)

  // Renders once at upload: the title comes from Comark, and the first view hits a warm cache.
  const parsedTitle = kind === "markdown" && text ? (await renderMarkdownCached(key, text)).title : undefined
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
    await blob.del(key)
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
  if (!entries.some(([path]) => path === "index.html")) throw new HTTPError({ status: 400, statusText: "An app needs an index.html." })
  if (entries.length > MAX_APP_FILES) throw new HTTPError({ status: 413, statusText: `An app can have at most ${MAX_APP_FILES} files.` })
  const encoder = new TextEncoder()
  const encoded = entries.map(([path, content]) => [path, encoder.encode(content)] as const)
  const size = encoded.reduce((total, [, bytes]) => total + bytes.byteLength, 0)
  if (size > MAX_FILE_BYTES) throw new HTTPError({ status: 413, statusText: "An app can be at most 4 MiB." })

  const now = Date.now()
  let row = input.id ? await findDrop(input.id) : null
  if (input.id && (!row || row.kind !== "app")) throw new HTTPError({ status: 404, statusText: "No app with that id." })
  if (row && !permissions(row, who).edit) throw new HTTPError({ status: 403, statusText: "You can't edit this app." })

  const id = row?.id ?? crypto.randomUUID()
  const old = row ? await db.select().from(dropFiles).where(eq(dropFiles.dropId, id)) : []
  for (const [path, bytes] of encoded) {
    const [error] = await blob.put(`apps/${id}/${path}`, bytes, { access: "private", contentType: contentTypeOf(path) })
    if (error) throw storageFailure(error)
  }
  const kept = new Set(encoded.map(([path]) => path))
  const removed = old.filter(file => !kept.has(file.path)).map(file => file.blobKey)
  if (removed.length) await blob.del(removed)

  if (row) {
    await db.update(drops).set({ title: input.name?.trim() || row.title, size, version: row.version + 1, actorKind: who.actorKind, actorName: who.actorName, updatedAt: now }).where(eq(drops.id, id))
    await db.delete(dropFiles).where(eq(dropFiles.dropId, id))
  }
  else {
    const name = input.name?.trim() || "Untitled app"
    row = {
      id, ownerId: who.userId, kind: "app", title: name.slice(0, 160),
      filename: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app"}/`,
      blobKey: null, contentType: null, size, version: 1, supersedesId: null, visibility: "private", access: "comment",
      actorKind: who.actorKind, actorName: who.actorName, createdAt: now, updatedAt: now,
    }
    await db.insert(drops).values(row)
    await bumpUploadCount()
  }
  await db.insert(dropFiles).values(encoded.map(([path, bytes]) => ({ dropId: id, path, blobKey: `apps/${id}/${path}`, size: bytes.byteLength })))
  return (await findDrop(id))!
}

/** Removes a drop, its files, and its comments. */
export async function deleteDrop(row: DropRow) {
  const files = row.kind === "app" ? await db.select().from(dropFiles).where(eq(dropFiles.dropId, row.id)) : []
  await db.delete(drops).where(eq(drops.id, row.id))
  const keys = [...files.map(file => file.blobKey), ...(row.blobKey ? [row.blobKey] : [])]
  if (keys.length) await blob.del(keys)
}

export const dropPageUrl = (origin: string, id: string) => new URL(`/d/${id}`, origin).href
