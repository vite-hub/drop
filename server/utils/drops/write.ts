import type { AgentMetadata } from "#shared/agent"
import { and, eq, exists, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import * as v from "valibot"
import { blob, detectContentType } from "vite-hub/blob"
import { db } from "vite-hub/database"
import { blobCleanup, dropFiles, drops, dropVersions, suggestionAcceptances } from "../../databases/default/index"
import { newLink, slugify } from "#shared/links"
import { BOARD_CONTENT_TYPE, BOARD_EXTENSION, emptyBoard, parseBoard, serializeBoard } from "#shared/board"
import { kindFromFilename, titleFromSource, videoType } from "#shared/plans"
import { refreshLatest } from "../live-drafts"
import { deleteMarkdownCache } from "../markdown-cache"
import { appLinkIssues, contentTypeOf } from "#shared/project-bundle"
import { defaultShare, isPublic, type Share } from "#shared/share"
import { MAX_KEEP_REASON } from "#shared/expiry"
import { shareReviewFor } from "../trust"
import type { Identity } from "../identity"
import { background, logDrop } from "../logs"
import { requireKeepSlot, withDropQuota } from "../quotas"
import { expiryPolicy } from "../expiry"
import { touchFolder, uniqueSlug } from "../nodes"
import { modeFor, shareFields } from "../share"
import { textStatements } from "../search"
import type { DropKind } from "#shared/types"
import type { DropRow, LifetimeInput } from "./types"
import { MAX_FILE_BYTES } from "#shared/schemas"
import { editorImageExtension } from "#shared/editor-images"
import { MAX_APP_BYTES, MAX_APP_FILES, MIB } from "#shared/quotas"
import { permissions } from "./access"
import { findDrop, findDropByBlob, storageFailure } from "./query"
import { d1Chunks } from "../d1"

const Unavailable = v.object({ status: v.literal(503) })

const TEXT_KINDS = new Set(["markdown", "html"])
const FILE_LINK = /\/f\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,16})/gi

async function referencedFileKeys(html: string, origin: string) {
  const keys = new Set<string>()
  const { htmlToMarkdown } = await import("mdream")
  htmlToMarkdown(html, {
    format: "text",
    extraction: {
      "img[src], a[href]": ({ tagName, attributes }) => {
        const reference = tagName === "img" ? attributes.src : attributes.href
        if (!reference || !(reference.startsWith("/") || /^https?:\/\//i.test(reference))) return
        const url = URL.parse(reference, origin)
        if (!url || url.origin !== origin) return
        const [match] = url.pathname.matchAll(FILE_LINK)
        if (match?.[1] && match[0] === url.pathname) keys.add(match[1])
      },
    },
  })
  return [...keys]
}

async function adoptAttachments(doc: DropRow, source: string) {
  const keys = [...new Set([...source.matchAll(FILE_LINK)].map((match) => match[1]!))]
  for (const chunk of d1Chunks(keys))
    await db
      .update(drops)
      .set({ parentId: doc.id })
      .where(
        and(
          inArray(drops.blobKey, chunk),
          eq(drops.ownerId, doc.ownerId),
          inArray(drops.kind, ["image", "file"]),
          isNull(drops.parentId),
          ne(drops.id, doc.id),
        ),
      )
}

export function lifetimeFields(
  who: Identity,
  input: LifetimeInput,
  previous: Pick<DropRow, "lifetime" | "keepReason"> | null,
  event?: H3Event,
) {
  const lifetime = input.lifetime ?? previous?.lifetime ?? "review"
  if (lifetime !== "keep") return { lifetime, keepReason: null }
  if (!input.lifetime) return { lifetime, keepReason: previous?.keepReason ?? null }
  if (!expiryPolicy(event).custom && who.role !== "admin")
    throw new HTTPError({ status: 403, statusText: "Only admins can keep drops on this Drop. Use review instead." })
  const reason = input.keepReason?.trim().replace(/\s+/g, " ")
  if (who.actorKind === "agent" && !reason)
    throw new HTTPError({
      status: 400,
      statusText: "Say why this drop should be kept (keepReason), for example the pull request it belongs to.",
    })
  if (reason && reason.length > MAX_KEEP_REASON)
    throw new HTTPError({ status: 400, statusText: `Keep the reason under ${MAX_KEEP_REASON} characters.` })
  return { lifetime, keepReason: who.actorKind === "agent" ? reason! : null }
}

async function queueBlobCleanup(keys: string[]) {
  const unique = [...new Set(keys)]
  if (!unique.length) return
  try {
    for (const chunk of d1Chunks(unique, { perItem: 3, others: 0 }))
      await db
        .insert(blobCleanup)
        .values(chunk.map((blobKey) => ({ id: crypto.randomUUID(), blobKey, createdAt: Date.now() })))
        .onConflictDoNothing()
  } catch (error) {
    background.error({ action: "blob-cleanup-queue", error: String(error) })
  }
}

export async function drainBlobCleanup() {
  await deleteBlobKeys(
    (await db.select({ key: blobCleanup.blobKey }).from(blobCleanup).limit(20)).map((item) => item.key),
  )
}

export async function deleteBlobKeys(keys: string[]) {
  const unique = [...new Set(keys)]
  if (!unique.length) return
  try {
    await Promise.all(unique.map(deleteMarkdownCache))
  } catch (error) {
    background.error({ action: "markdown-cache-cleanup", error: String(error) })
    await queueBlobCleanup(unique)
    return
  }
  const [error] = await blob.delete(unique)
  if (error) {
    background.error({ action: "blob-cleanup", error: error.message, keys: unique.length })
    await queueBlobCleanup(unique)
    return
  }
  for (const chunk of d1Chunks(unique)) await db.delete(blobCleanup).where(inArray(blobCleanup.blobKey, chunk))
}

export function requireBase(latest: Pick<DropRow, "id" | "version">, base: number | undefined) {
  if (base !== undefined && base !== latest.version)
    throw new HTTPError({
      status: 409,
      message: `v${latest.version} is the latest version of ${latest.id}, not v${base}, so nothing was published. Call read_drop for ${latest.id} again, carry its changes and comments into your version, and publish with base: ${latest.version}.`,
    })
}

export async function createDocDrop(
  who: Identity,
  input: LifetimeInput & {
    agent?: AgentMetadata
    base?: number
    filename: string
    bytes: Uint8Array
    title?: string
    slug?: string
    nameFromSlug?: boolean
    supersedes?: string
    acceptedSuggestionId?: string
    undoneSuggestionId?: string
    share?: Share
    folder?: DropRow
    attachment?: DropRow
  },
  event?: H3Event,
) {
  await drainBlobCleanup()
  if (input.bytes.byteLength > MAX_FILE_BYTES)
    throw new HTTPError({ status: 413, statusText: "The file exceeds the 4 MiB limit." })
  let filename = input.filename.replace(/[/\\]/g, "-").slice(0, 200) || "drop"
  let contentType = detectContentType(input.bytes) ?? "application/octet-stream"
  const { attachment } = input
  if (attachment) {
    const imageExtension = editorImageExtension(contentType)
    if (!imageExtension)
      throw new HTTPError({ status: 415, statusText: "Choose a PNG, JPEG, GIF, WebP, or BMP image." })
    filename = `${filename.replace(/\.[a-z0-9]{1,16}$/i, "") || "image"}${imageExtension}`
  }
  const extension = filename.match(/\.[a-z0-9]{1,16}$/i)?.[0].toLowerCase() ?? ""
  let kind: DropKind = kindFromFilename(filename)
  let text: string | undefined
  if ([".md", ".markdown", ".html", ".htm", ".txt"].includes(extension)) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes)
    } catch {
      throw new HTTPError({
        status: 400,
        statusText: `${kind === "html" ? "HTML" : "Text"} files must contain valid UTF-8.`,
      })
    }
    contentType = kind === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8"
  }
  if (extension === BOARD_EXTENSION) {
    try {
      const board = input.bytes.byteLength
        ? parseBoard(new TextDecoder("utf-8", { fatal: true }).decode(input.bytes))
        : emptyBoard()
      text = serializeBoard(board)
      input = { ...input, bytes: new TextEncoder().encode(text) }
    } catch {
      throw new HTTPError({ status: 400, statusText: "That isn't a board this Drop can read." })
    }
    kind = "board"
    contentType = BOARD_CONTENT_TYPE
  }
  if (kind === "file" && contentType.startsWith("image/")) kind = "image"
  if (kind === "file" && contentType === "application/octet-stream") contentType = videoType(filename) ?? contentType

  let previous: DropRow | null = null
  if (input.supersedes) {
    const found = (await findDrop(input.supersedes)) ?? (await findDropByBlob(input.supersedes))
    const can = found && permissions(found, who)
    if (found?.expired && can && can.manage)
      throw new HTTPError({
        status: 409,
        statusText: "That drop is in the Trash. Restore it first, or publish a new drop.",
      })
    if (found && can && can.edit) {
      if (found.kind === "app")
        throw new HTTPError({ status: 400, statusText: "That drop is an app; publish its next version with files." })
      if (found.kind === "link")
        throw new HTTPError({
          status: 400,
          statusText: "That drop is a link, which has no versions. Change it with update_drop.",
        })
      if (!can.manage && kind !== found.kind)
        throw new HTTPError({ status: 403, statusText: "Only the drop's owner can change what kind of file it is." })
      previous = found.head ? await findDrop(found.id) : found
      if (previous) requireBase(previous, input.base)
    }
  }
  const own = previous?.raw ?? previous
  const folder = previous ? null : (input.folder ?? null)
  const parentId = attachment?.id ?? previous?.parentId ?? folder?.id ?? null
  const ownerId =
    attachment?.ownerId ?? previous?.ownerId ?? (folder && !folder.teamFolder ? folder.ownerId : who.userId)
  const life = parentId
    ? lifetimeFields(who, {}, attachment ?? own ?? folder, event)
    : lifetimeFields(who, input, own, event)
  await requireKeepSlot(ownerId, life, own?.lifetime === "keep", !parentId)
  const mode = modeFor(previous ?? folder, event)
  const share = attachment
    ? { share: "private" as const, publicUntil: null }
    : input.share !== undefined
      ? shareFields(input.share, { kind, team: mode === "team" }, event)
      : own
        ? { share: own.share, publicUntil: own.publicUntil }
        : { share: defaultShare(mode), publicUntil: null }

  const warnings =
    kind === "markdown" && text !== undefined
      ? await (await import("../markdown-document")).requirePublishableMarkdown(text, event)
      : []
  return withDropQuota(
    ownerId,
    { drops: previous || attachment ? 0 : 1, bytes: input.bytes.byteLength, writes: 1, targetId: previous?.id },
    event,
    async (quota) => {
      const key = `${crypto.randomUUID()}${extension}`
      const [storageError] = await blob.put(key, input.bytes, { contentType })
      if (storageError) {
        await deleteBlobKeys([key])
        throw storageFailure(storageError)
      }

      let parsedTitle: string | undefined
      let draftKeys: string[] = []
      try {
        if (kind === "markdown" && text) {
          const { renderMarkdownCached } = await import("../markdown-document")
          const rendered = await renderMarkdownCached(key, async () => text, event)
          parsedTitle = rendered.title
          if (own && event) draftKeys = await referencedFileKeys(rendered.html, event.url.origin)
        }
      } catch (error) {
        await deleteBlobKeys([key])
        throw error
      }
      const markdownTitle = parsedTitle === "Untitled document" ? undefined : parsedTitle
      const now = Date.now()
      const title = (
        input.title?.trim() ||
        markdownTitle ||
        titleFromSource(text ?? "", kind, filename, previous?.title)
      ).slice(0, 160)
      const named = (input.slug && slugify(input.slug)) || previous?.slug || slugify(title)
      const slug = named === previous?.slug ? named : await uniqueSlug(parentId, named, previous?.id)
      if (input.nameFromSlug) filename = `${slug || "doc"}${extension}`
      const row: DropRow = {
        id: previous?.id ?? newLink(),
        ownerId,
        kind,
        title,
        filename,
        blobKey: key,
        contentType,
        size: input.bytes.byteLength,
        version: (previous?.version ?? 0) + 1,
        slug,
        ...share,
        teamFolder: false,
        actorKind: who.actorKind,
        actorName: who.actorName,
        agent: who.actorKind === "agent" ? (input.agent ?? null) : null,
        sessionPublisherId: who.actorKind === "agent" && input.agent?.session ? who.userId : null,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        ...life,
        note: input.note?.trim() || null,
        trashedAt: null,
        trashReason: null,
        parentId,
        draftImage: Boolean(attachment),
        shareReview: isPublic(share.share) ? await shareReviewFor(ownerId, event) : null,
        quarantinedAt: own?.quarantinedAt ?? null,
        publishToken: null,
        teamId: null,
        siteUrl: null,
        resources: own?.resources ?? null,
      }
      try {
        const write = own
          ? [
              db.insert(dropVersions).select((qb) =>
                qb
                  .select({
                    dropId: drops.id,
                    version: drops.version,
                    kind: drops.kind,
                    title: drops.title,
                    filename: drops.filename,
                    blobKey: drops.blobKey,
                    contentType: drops.contentType,
                    size: drops.size,
                    note: drops.note,
                    actorKind: drops.actorKind,
                    actorName: drops.actorName,
                    agent: drops.agent,
                    createdAt: drops.createdAt,
                  })
                  .from(drops)
                  .where(and(eq(drops.id, own.id), eq(drops.version, own.version))),
              ),
              db
                .update(drops)
                .set(row)
                .where(and(eq(drops.id, own.id), eq(drops.version, own.version))),
            ]
          : [db.insert(drops).values(row)]
        await quota.commit(
          [
            ...write,
            ...d1Chunks(draftKeys).map((chunk) =>
              db
                .update(drops)
                .set({ draftImage: false })
                .where(and(eq(drops.parentId, row.id), eq(drops.draftImage, true), inArray(drops.blobKey, chunk))),
            ),
            ...textStatements(row, text),
            ...(folder ? [touchFolder(folder.id, now)] : []),
            ...(input.acceptedSuggestionId
              ? [
                  db
                    .delete(suggestionAcceptances)
                    .where(
                      and(
                        eq(suggestionAcceptances.threadId, input.acceptedSuggestionId),
                        isNotNull(suggestionAcceptances.undoneVersion),
                      ),
                    ),
                  db
                    .insert(suggestionAcceptances)
                    .values({ threadId: input.acceptedSuggestionId, dropId: row.id, version: row.version }),
                ]
              : []),
            ...(input.undoneSuggestionId
              ? [
                  db
                    .insert(suggestionAcceptances)
                    .values({
                      threadId: input.undoneSuggestionId,
                      dropId: row.id,
                      version: row.version - 1,
                      undoneVersion: row.version,
                    })
                    .onConflictDoUpdate({
                      target: suggestionAcceptances.threadId,
                      set: { undoneVersion: row.version },
                      setWhere: and(
                        isNull(suggestionAcceptances.undoneVersion),
                        eq(suggestionAcceptances.version, row.version - 1),
                      ),
                    }),
                ]
              : []),
          ],
          and(
            own
              ? exists(
                  db
                    .select({ id: drops.id })
                    .from(drops)
                    .where(and(eq(drops.id, row.id), eq(drops.blobKey, key))),
                )
              : attachment
                ? exists(
                    db
                      .select({ id: drops.id })
                      .from(drops)
                      .where(and(eq(drops.id, attachment.id), eq(drops.kind, "markdown"))),
                  )
                : sql`1`,
            input.undoneSuggestionId
              ? exists(
                  db
                    .select({ id: suggestionAcceptances.threadId })
                    .from(suggestionAcceptances)
                    .where(
                      and(
                        eq(suggestionAcceptances.threadId, input.undoneSuggestionId),
                        eq(suggestionAcceptances.undoneVersion, row.version),
                      ),
                    ),
                )
              : undefined,
          ),
        )
      } catch (error) {
        await deleteBlobKeys([key])
        if (previous && /unique|constraint/i.test(String(error)))
          throw new HTTPError({
            status: 409,
            statusText: "This drop was published by someone else. Retry from the latest version.",
            cause: error,
          })
        throw error
      }
      if (text && TEXT_KINDS.has(kind)) await adoptAttachments(row, text)
      if (previous) await refreshLatest(row.id)
      logDrop(event, row, { change: "publish" })
      return Object.assign(row, { warnings })
    },
  )
}

function linkedText(files: (readonly [string, Uint8Array])[]) {
  const decoder = new TextDecoder()
  return Object.fromEntries(
    files.flatMap(([path, bytes]) => (/\.(html?|css|m?js)$/i.test(path) ? [[path, decoder.decode(bytes)]] : [])),
  )
}

function cleanPath(path: string) {
  const clean = path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/")
  if (!clean || clean.length > 300 || escapesFolder(clean))
    throw new HTTPError({ status: 400, message: `Invalid file path: ${path}` })
  return clean
}

export function escapesFolder(path: string) {
  let decoded = path
  for (let round = 0; round < 3; round++) {
    if (/%(?:2f|5c)/i.test(decoded)) return true
    let next = decoded
    try {
      next = decodeURIComponent(decoded)
    } catch {}
    if (next === decoded) break
    decoded = next
  }
  return decoded
    .replace(/\\/g, "/")
    .split("/")
    .some((part) => part === "." || part === "..")
}

export async function publishApp(
  who: Identity,
  input: LifetimeInput & {
    agent?: AgentMetadata
    base?: number
    id?: string
    name?: string
    slug?: string
    files: Record<string, string | Uint8Array>
    removes?: string[]
    replace?: boolean
    share?: Share
    folder?: DropRow
  },
  event?: H3Event,
) {
  const entries = Object.entries(input.files ?? {}).map(([path, content]) => [cleanPath(path), content] as const)
  if (new Set(entries.map(([path]) => path)).size !== entries.length)
    throw new HTTPError({ status: 400, statusText: "An app cannot contain duplicate paths." })
  const removes = [...new Set((input.removes ?? []).map(cleanPath))]
  const clash = removes.filter((path) => entries.some(([sent]) => sent === path))
  if (clash.length)
    throw new HTTPError({
      status: 400,
      message: `removes and files both name ${clash.join(", ")}. Send a file to keep it, or name it in removes to delete it.`,
    })
  if (input.replace && removes.length)
    throw new HTTPError({ status: 400, statusText: "An archive replaces the whole app, so it takes no removes." })
  const encoder = new TextEncoder()
  const encoded = entries.map(
    ([path, content]) => [path, typeof content === "string" ? encoder.encode(content) : content] as const,
  )
  if (entries.length > MAX_APP_FILES)
    throw new HTTPError({ status: 413, statusText: `An app can have at most ${MAX_APP_FILES} files.` })
  if (encoded.reduce((total, [, bytes]) => total + bytes.byteLength, 0) > MAX_APP_BYTES)
    throw new HTTPError({ status: 413, statusText: `An app can be at most ${MAX_APP_BYTES / MIB} MiB.` })
  if (input.id && !entries.length && !removes.length)
    throw new HTTPError({ status: 400, statusText: "Send the files that changed, or name files in removes." })

  await drainBlobCleanup()
  const now = Date.now()
  let row: DropRow | null = input.id ? await findDrop(input.id) : null
  if (input.id && (!row || row.kind !== "app")) throw new HTTPError({ status: 404, statusText: "No app with that id." })
  if (row?.expired && permissions(row, who).manage)
    throw new HTTPError({
      status: 409,
      statusText: "That app is in the Trash. Restore it first, or publish a new app.",
    })
  if (row && !permissions(row, who).edit) throw new HTTPError({ status: 403, statusText: "You can't edit this app." })
  if (row) requireBase(row, input.base)
  const own = row?.raw ?? row
  const folder = row ? null : (input.folder ?? null)
  const parentId = row?.parentId ?? folder?.id ?? null
  const ownerId = row?.ownerId ?? (folder && !folder.teamFolder ? folder.ownerId : who.userId)
  const life = parentId ? lifetimeFields(who, {}, own ?? folder, event) : lifetimeFields(who, input, row, event)
  await requireKeepSlot(ownerId, life, row?.lifetime === "keep", !parentId)
  const note = input.note?.trim() || null
  const mode = modeFor(row ?? folder, event)
  const share =
    input.share !== undefined
      ? shareFields(input.share, { kind: "app", team: mode === "team" }, event)
      : own
        ? { share: own.share, publicUntil: own.publicUntil }
        : { share: defaultShare(mode), publicUntil: null }
  const shareReview = !isPublic(share.share)
    ? null
    : own && isPublic(own.share) && input.share === undefined
      ? (own.shareReview ?? null)
      : await shareReviewFor(ownerId, event)

  const id = row?.id ?? newLink()
  const prefix = `apps/${id}/${crypto.randomUUID()}`
  const token = crypto.randomUUID()
  const old = row
    ? await db
        .select({ path: dropFiles.path, blobKey: dropFiles.blobKey, size: dropFiles.size })
        .from(dropFiles)
        .where(eq(dropFiles.dropId, id))
    : []
  const stale = removes.filter((path) => !old.some((file) => file.path === path))
  if (stale.length)
    throw new HTTPError({
      status: 400,
      message: `removes names ${stale.join(", ")}, which ${stale.length === 1 ? "isn't" : "aren't"} in ${row ? `v${row.version}` : "a new app"}. Nothing was published.`,
    })
  const sent = new Set(entries.map(([path]) => path))
  const kept = input.replace ? [] : old.filter((file) => !removes.includes(file.path) && !sent.has(file.path))
  const paths = [...kept.map((file) => file.path), ...entries.map(([path]) => path)]
  if (!paths.includes("index.html"))
    throw new HTTPError({
      status: 400,
      statusText: row ? "That would leave the app without an index.html." : "An app needs an index.html.",
    })
  if (paths.length > MAX_APP_FILES)
    throw new HTTPError({ status: 413, statusText: `An app can have at most ${MAX_APP_FILES} files.` })
  const size =
    kept.reduce((total, file) => total + file.size, 0) +
    encoded.reduce((total, [, bytes]) => total + bytes.byteLength, 0)
  if (size > MAX_APP_BYTES)
    throw new HTTPError({ status: 413, statusText: `An app can be at most ${MAX_APP_BYTES / MIB} MiB.` })
  const oldSize = old.reduce((total, file) => total + file.size, 0)
  return withDropQuota(
    ownerId,
    {
      drops: row ? 0 : 1,
      bytes: Math.max(0, size - oldSize),
      writes: entries.length,
      targetId: row?.id,
      app: { files: paths.length, bytes: size },
    },
    event,
    async (quota) => {
      const stagedKeys: string[] = []
      let committedPublish = false
      try {
        const queue = [...encoded]
        let failed = false
        const put = async () => {
          for (let next = queue.shift(); next && !failed; next = queue.shift()) {
            const [path, bytes] = next
            const blobKey = `${prefix}/${path}`
            stagedKeys.push(blobKey)
            try {
              const [error] = await blob.put(blobKey, bytes, { contentType: contentTypeOf(path) })
              if (error) throw storageFailure(error)
            } catch (error) {
              failed = true
              throw error
            }
          }
        }
        const puts = await Promise.allSettled(Array.from({ length: Math.min(6, queue.length) }, put))
        const rejected = puts.find((result) => result.status === "rejected")
        if (rejected) throw rejected.reason

        const name = input.name?.trim() || row?.title || "Untitled app"
        const named = (input.slug && slugify(input.slug)) || row?.slug || slugify(name)
        const slug = named === row?.slug ? named : await uniqueSlug(parentId, named, row?.id)
        const next: DropRow = {
          id,
          ownerId,
          kind: "app",
          title: name.slice(0, 160),
          filename: row?.filename ?? `${slug || "app"}/`,
          blobKey: null,
          contentType: null,
          size,
          version: (row?.version ?? 0) + 1,
          slug,
          shareReview,
          quarantinedAt: own?.quarantinedAt ?? null,
          ...share,
          teamFolder: false,
          actorKind: who.actorKind,
          actorName: who.actorName,
          agent: who.actorKind === "agent" ? (input.agent ?? null) : null,
          sessionPublisherId: who.actorKind === "agent" && input.agent?.session ? who.userId : null,
          createdAt: row?.createdAt ?? now,
          updatedAt: now,
          publishToken: token,
          draftImage: false,
          teamId: null,
          lastAccessedAt: now,
          ...life,
          note,
          trashedAt: null,
          trashReason: null,
          parentId,
          siteUrl: null,
          resources: own?.resources ?? null,
        }
        const fileRows = [
          ...kept.map((file) => ({ dropId: id, path: file.path, blobKey: file.blobKey, size: file.size })),
          ...encoded.map(([path, bytes]) => ({
            dropId: id,
            path,
            blobKey: `${prefix}/${path}`,
            size: bytes.byteLength,
          })),
        ]
        if (!row) {
          await quota.commit([
            db.insert(drops).values(next),
            ...quota.fileInserts(fileRows),
            ...(folder ? [touchFolder(folder.id, now)] : []),
          ])
          committedPublish = true
        } else {
          const update = db
            .update(drops)
            .set({
              title: next.title,
              slug,
              size,
              version: next.version,
              actorKind: next.actorKind,
              actorName: next.actorName,
              agent: next.agent,
              sessionPublisherId: next.sessionPublisherId,
              updatedAt: now,
              lastAccessedAt: now,
              publishToken: token,
              ...life,
              note,
              ...share,
              shareReview,
            })
            .where(and(eq(drops.id, id), eq(drops.version, row.version)))
          const won = and(eq(drops.id, id), eq(drops.publishToken, token))
          const replace = db
            .delete(dropFiles)
            .where(and(eq(dropFiles.dropId, id), exists(db.select({ id: drops.id }).from(drops).where(won))))
          const inserts = fileRows.map((file) =>
            db.insert(dropFiles).select((qb) =>
              qb
                .select({
                  dropId: drops.id,
                  path: sql<string>`${file.path}`.as("path"),
                  blobKey: sql<string>`${file.blobKey}`.as("blob_key"),
                  size: sql<number>`${file.size}`.as("size"),
                })
                .from(drops)
                .where(won),
            ),
          )
          await quota.commit([update, replace, ...inserts], exists(db.select({ id: drops.id }).from(drops).where(won)))
          committedPublish = true
          await deleteBlobKeys(old.filter((file) => !kept.includes(file)).map((file) => file.blobKey))
          await refreshLatest(next.id)
        }
        logDrop(event, next, { change: "publish" })
        return Object.assign(next, { warnings: appLinkIssues(linkedText(encoded), paths), paths })
      } catch (error) {
        if (!committedPublish) {
          await deleteBlobKeys(stagedKeys)
        }
        if (row && !v.is(Unavailable, error) && /unique|constraint/i.test(String(error)))
          throw new HTTPError({
            status: 409,
            statusText: "This app was published by someone else. Retry from the latest version.",
            cause: error,
          })
        throw error
      }
    },
  )
}
