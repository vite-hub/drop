import { and, eq, exists, inArray, sql } from "drizzle-orm"
import { log } from "evlog"
import { type H3Event, HTTPError } from "h3"
import * as v from "valibot"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { db } from "vite-hub/database/drizzle"
import { blobCleanup, dropFiles, drops } from "../../databases/config"
import { newLink, slugify } from "#shared/links"
import { BOARD_CONTENT_TYPE, BOARD_EXTENSION, emptyBoard, parseBoard } from "#shared/board"
import { kindFromFilename, titleFromSource, videoType } from "#shared/plans"
import { renderMarkdownCached } from "../markdown-document"
import { deleteMarkdownCache } from "../markdown-cache"
import { appLinkIssues, contentTypeOf } from "#shared/project-bundle"
import { defaultShare, isPublic, type Share } from "#shared/share"
import { MAX_KEEP_REASON } from "#shared/expiry"
import { shareReviewFor } from "../trust"
import type { Identity } from "../identity"
import { withDropQuota } from "../quotas"
import { chainOf, expiryPolicy, renewDrop } from "../expiry"
import { touchFolder, uniqueSlug } from "../nodes"
import { sharePolicy, shareFields } from "../share"
import { textStatements } from "../search"
import type { DropKind } from "#shared/types"
import type { DropRow, LifetimeInput } from "./types"
import { MAX_FILE_BYTES } from "#shared/schemas"
import { MAX_APP_BYTES, MAX_APP_FILES, MIB } from "#shared/quotas"
import { splitFrontmatter } from "#shared/frontmatter"
import { permissions } from "./access"
import { findDrop, findDropByBlob, versionChain, storageFailure } from "./query"

// Storage that was down (503), not a row someone else published first.
const Unavailable = v.object({ status: v.literal(503) })

const TEXT_KINDS = new Set(["markdown", "html"])
/** `/f/<key>` links in a doc's source, absolute or relative, with or without `?raw`. */
const FILE_LINK = /\/f\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,16})/gi

/**
 * Makes the files a doc embeds its attachments, so they share its sharing, lifetime, and Trash. Only the doc owner's
 * own files that aren't docs themselves: embedding never exposes someone else's file. A file already attached to
 * another doc stays with that one, unless it's an older version of this doc.
 */
async function adoptAttachments(doc: DropRow, source: string, previous: DropRow | null) {
  // 90 keys and the other parameters stay under D1's 100 bound parameters per query.
  const keys = [...new Set([...source.matchAll(FILE_LINK)].map((match) => match[1]!))].slice(0, 90)
  if (!keys.length) return
  const chain = previous ? (await versionChain(previous)).map((item) => item.id) : []
  const owned = await db
    .select({ id: drops.id, parentId: drops.parentId })
    .from(drops)
    .where(and(inArray(drops.blobKey, keys), eq(drops.ownerId, doc.ownerId), inArray(drops.kind, ["image", "file"])))
  const ids = owned.filter((item) => !item.parentId || chain.includes(item.parentId)).map((item) => item.id)
  if (ids.length) await db.update(drops).set({ parentId: doc.id }).where(inArray(drops.id, ids))
}

/** What the publisher says about a drop's life. Later versions inherit it unless they say otherwise. */
/**
 * Agents may keep a drop when they say why; people just choose. On a Drop that turned keeping off, only admins keep.
 * Returns the columns to store.
 */
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
    for (let offset = 0; offset < unique.length; offset += 25)
      await db
        .insert(blobCleanup)
        .values(
          unique
            .slice(offset, offset + 25)
            .map((blobKey) => ({ id: crypto.randomUUID(), blobKey, createdAt: Date.now() })),
        )
        .onConflictDoNothing()
  } catch (error) {
    log.error({ action: "blob-cleanup-queue", error: String(error) })
  }
}

/** Retries cleanup left by an earlier metadata operation, in one batch. */
export async function drainBlobCleanup() {
  await deleteBlobKeys(
    (await db.select({ key: blobCleanup.blobKey }).from(blobCleanup).limit(20)).map((item) => item.key),
  )
}

/**
 * Deletes blobs whose metadata is already gone. A failure doesn't fail the request (the publish or delete already
 * happened): the keys stay queued and the next drop operation retries them.
 */
export async function deleteBlobKeys(keys: string[]) {
  const unique = [...new Set(keys)]
  if (!unique.length) return
  try {
    await Promise.all(unique.map(deleteMarkdownCache))
  } catch (error) {
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

/**
 * Stores one file as a private doc drop. Markdown and HTML must be UTF-8. `slug` names the link (the previous
 * version's, or the title's, otherwise); with `nameFromSlug` the file is called after it too, keeping the extension.
 * `folder` (checked by `requireFolder`) places a new drop in it. A drop in a folder lives as long as the folder, so it
 * takes no lifetime of its own, and its slug gets a number when another drop in the folder has it.
 */
export async function createDocDrop(
  who: Identity,
  input: LifetimeInput & {
    filename: string
    bytes: Uint8Array
    title?: string
    slug?: string
    nameFromSlug?: boolean
    supersedes?: string
    share?: Share
    folder?: DropRow
  },
  event?: H3Event,
) {
  await drainBlobCleanup()
  if (input.bytes.byteLength > MAX_FILE_BYTES)
    throw new HTTPError({ status: 413, statusText: "The file exceeds the 4 MiB limit." })
  let filename = input.filename.replace(/[/\\]/g, "-").slice(0, 200) || "drop"
  const extension = filename.match(/\.[a-z0-9]{1,16}$/i)?.[0].toLowerCase() ?? ""
  let kind: DropKind = kindFromFilename(filename)
  let contentType = detectContentType(input.bytes) ?? "application/octet-stream"
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
    // An empty .tldr starts an empty board (the New menu's Board).
    if (!input.bytes.byteLength) input = { ...input, bytes: new TextEncoder().encode(JSON.stringify(emptyBoard())) }
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes)
      parseBoard(text)
    } catch {
      throw new HTTPError({ status: 400, statusText: "That isn't a board this Drop can read." })
    }
    kind = "board"
    contentType = BOARD_CONTENT_TYPE
  }
  if (kind === "file" && contentType.startsWith("image/")) kind = "image"
  // The bytes only tell images and PDFs apart; files are served with nosniff, so a video needs its type to play.
  if (kind === "file" && contentType === "application/octet-stream") contentType = videoType(filename) ?? contentType

  let previous: DropRow | null = null
  const supersedes =
    input.supersedes ??
    (text
      ? splitFrontmatter(text).frontmatter?.match(
          /^supersedes:\s*["']?(?:\S*\/)?([0-9a-f-]{36})(?:\.\w+)?["']?\s*$/m,
        )?.[1]
      : undefined)
  if (supersedes) {
    const found = (await findDrop(supersedes)) ?? (await findDropByBlob(supersedes))
    const can = found && permissions(found, who)
    // An expired drop is read-only even for its owner, so check the Trash before the edit right.
    if (found?.expired && can && can.manage)
      throw new HTTPError({
        status: 409,
        statusText: "That drop is in the Trash. Restore it first, or publish a new drop.",
      })
    if (found && can && can.edit) {
      if (found.kind === "app")
        throw new HTTPError({ status: 400, statusText: "That drop is an app; publish its next version with files." })
      if (!can.manage && kind !== found.kind)
        throw new HTTPError({ status: 403, statusText: "Only the drop's owner can change what kind of file it is." })
      previous = (await versionChain(found))[0] ?? found
    }
  }
  const folder = previous ? null : (input.folder ?? null)
  const parentId = previous?.parentId ?? folder?.id ?? null
  // A drop in someone's folder is theirs (admins add to anyone's); in a team folder it stays its publisher's.
  const ownerId = previous?.ownerId ?? (folder && !folder.teamFolder ? folder.ownerId : who.userId)
  const life = parentId
    ? lifetimeFields(who, {}, previous ?? folder, event)
    : lifetimeFields(who, input, previous, event)
  const share =
    input.share !== undefined
      ? shareFields(input.share, { kind }, event)
      : previous
        ? { share: previous.share, publicUntil: previous.publicUntil }
        : { share: defaultShare(sharePolicy(event).mode), publicUntil: null }

  return withDropQuota(
    ownerId,
    { drops: previous ? 0 : 1, bytes: input.bytes.byteLength, writes: 1, targetId: previous?.id },
    event,
    async (quota) => {
      const key = `${crypto.randomUUID()}${extension}`
      const [storageError] = await blob.put(key, input.bytes, { access: "private", contentType })
      if (storageError) {
        await deleteBlobKeys([key])
        throw storageFailure(storageError)
      }

      // Renders once at upload: the title comes from Comark, and the first view hits a warm cache.
      let parsedTitle: string | undefined
      try {
        parsedTitle =
          kind === "markdown" && text ? (await renderMarkdownCached(key, async () => text, event)).title : undefined
      } catch (error) {
        await deleteBlobKeys([key])
        throw error
      }
      const markdownTitle = parsedTitle === "Untitled document" ? undefined : parsedTitle
      const now = Date.now()
      // A version that doesn't name itself keeps its drop's title: a board or a file has only its filename to offer.
      const title = (
        input.title?.trim() ||
        markdownTitle ||
        titleFromSource(text ?? "", kind, filename, previous?.title)
      ).slice(0, 160)
      const named = (input.slug && slugify(input.slug)) || previous?.slug || slugify(title)
      const slug = named === previous?.slug ? named : await uniqueSlug(parentId, named, previous?.link)
      if (input.nameFromSlug) filename = `${slug || "doc"}${extension}`
      const row: DropRow = {
        id: crypto.randomUUID(),
        ownerId,
        kind,
        title,
        filename,
        blobKey: key,
        contentType,
        size: input.bytes.byteLength,
        version: (previous?.version ?? 0) + 1,
        supersedesId: previous?.id ?? null,
        link: previous?.link ?? newLink(),
        slug,
        ...share,
        teamFolder: false,
        actorKind: who.actorKind,
        actorName: who.actorName,
        createdAt: now,
        updatedAt: now,
        lastAccessedAt: now,
        ...life,
        note: input.note?.trim() || null,
        trashedAt: null,
        trashReason: null,
        parentId,
        // A public link waits for an admin's review again with each version: what it shows changed.
        shareReview: isPublic(share.share) ? await shareReviewFor(ownerId, event) : null,
        quarantinedAt: null,
        publishToken: null,
        siteUrl: null,
      }
      try {
        // A new version is a visit: the older versions restart their window with it, and take its lifetime.
        const chain = previous
          ? [
              renewDrop(previous, now),
              db
                .update(drops)
                .set(life)
                .where(sql`${drops.id} IN (${chainOf(previous)})`),
            ]
          : []
        await quota.commit(
          [
            db.insert(drops).values(row),
            ...textStatements(row, text, previous?.id),
            ...chain,
            ...(folder ? [touchFolder(folder.id, now)] : []),
          ],
          previous ? exists(db.select({ id: drops.id }).from(drops).where(eq(drops.id, previous.id))) : sql`1`,
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
      if (text && TEXT_KINDS.has(kind)) await adoptAttachments(row, text, previous)
      // TODO(repo-mirror): also commit this version to a repo the owner picks, one commit per version with the note
      // as its message. Drop stays the source of truth: versions keep living in Blob and the database on every host.
      // Waits on a public app-facing API in @vite-hub/forge (`commitFiles()` through the `forges` library), which is
      // internal-only on vite-hub/vitehub's feat/forge-primitive branch today, and on a token that may write to the
      // owner's repo (a GitHub App install, or a wider scope on GitHub sign-in).
      return row
    },
  )
}

/** The files whose references `appLinkIssues` checks, as text. Fonts, images and the like reference nothing. */
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

/**
 * Whether a blob key part climbs out of its folder once decoded. ViteHub's blob store percent-decodes every key before
 * its driver sees it, so `%2e%2e/` is `../`, which the fs driver resolves; a URL-based driver (S3) may decode again.
 * Either way an app's file could land on another drop's blob.
 */
export function escapesFolder(path: string) {
  let decoded = path
  for (let round = 0; round < 3; round++) {
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

/**
 * TODO(app-history): an app's next version replaces its files in place (same row, old blobs deleted), so apps have
 * no History tab, nothing to compare, and their comments never go outdated. Keeping each version (a row per version
 * like docs, or ViteHub Workspace history) would give them all three.
 *
 * Creates an app drop, or publishes the next version of one you may edit. A next version starts from the previous
 * one's files: `files` adds or replaces paths, and a path leaves the app only when `removes` names it, so an agent
 * that sends just the files it changed can't delete the rest by accident. With `replace` (a built app's archive),
 * `files` is the whole next version instead. `folder` places a new app in it, as in `createDocDrop`.
 */
export async function publishApp(
  who: Identity,
  input: LifetimeInput & {
    id?: string
    name?: string
    slug?: string
    /** Text, or bytes for a binary file from an archive. */
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
    // doctor-disable-next-line typescript/strict/no-runtime-typeof -- the parsed domain: an app file is text or bytes
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
  // An expired app is read-only even for its owner, so check the Trash before the edit right. Apps have no version chain.
  if (row?.expired && permissions(row, who).manage)
    throw new HTTPError({
      status: 409,
      statusText: "That app is in the Trash. Restore it first, or publish a new app.",
    })
  if (row && !permissions(row, who).edit) throw new HTTPError({ status: 403, statusText: "You can't edit this app." })
  // The app's own share, not the one a folder gives it: this writes the row.
  const own = row?.raw ?? row
  const folder = row ? null : (input.folder ?? null)
  const parentId = row?.parentId ?? folder?.id ?? null
  const ownerId = row?.ownerId ?? (folder && !folder.teamFolder ? folder.ownerId : who.userId)
  const life = parentId ? lifetimeFields(who, {}, own ?? folder, event) : lifetimeFields(who, input, row, event)
  const note = input.note?.trim() || null
  const share =
    input.share !== undefined
      ? shareFields(input.share, { kind: "app" }, event)
      : own
        ? { share: own.share, publicUntil: own.publicUntil }
        : { share: defaultShare(sharePolicy(event).mode), publicUntil: null }
  const shareReview = !isPublic(share.share)
    ? null
    : own && isPublic(own.share) && input.share === undefined
      ? (own.shareReview ?? null)
      : await shareReviewFor(ownerId, event)

  const id = row?.id ?? crypto.randomUUID()
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
  // Files the agent neither sent nor removed carry over, blob and all: no new write, no new bytes. An archive keeps none.
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
        // A few at a time: a built app has hundreds of files, and a Worker keeps only six connections open. After a
        // failure the others stop taking files, and all of them finish before the cleanup below deletes what they wrote.
        const queue = [...encoded]
        let failed = false
        const put = async () => {
          for (let next = queue.shift(); next && !failed; next = queue.shift()) {
            const [path, bytes] = next
            const blobKey = `${prefix}/${path}`
            stagedKeys.push(blobKey)
            try {
              const [error] = await blob.put(blobKey, bytes, { access: "private", contentType: contentTypeOf(path) })
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
        const slug = named === row?.slug ? named : await uniqueSlug(parentId, named, row?.link)
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
          supersedesId: row?.supersedesId ?? null,
          link: row?.link ?? newLink(),
          slug,
          shareReview,
          quarantinedAt: own?.quarantinedAt ?? null,
          ...share,
          teamFolder: false,
          actorKind: who.actorKind,
          actorName: who.actorName,
          createdAt: row?.createdAt ?? now,
          updatedAt: now,
          publishToken: token,
          lastAccessedAt: now,
          ...life,
          note,
          trashedAt: null,
          trashReason: null,
          parentId,
          siteUrl: null,
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
              link: next.link,
              slug,
              size,
              version: next.version,
              actorKind: next.actorKind,
              actorName: next.actorName,
              updatedAt: now,
              lastAccessedAt: now,
              publishToken: token,
              ...life,
              note,
              ...share,
              shareReview,
            })
            .where(and(eq(drops.id, id), eq(drops.version, row.version)))
          // The file set changes only if the update above won: both statements check for this publish's token.
          // (Builders, not raw `db.run(sql)`: D1's batch can't bind raw statements.)
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
        }
        return Object.assign(next, { warnings: appLinkIssues(linkedText(encoded), paths) })
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
