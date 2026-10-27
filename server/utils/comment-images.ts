import { asc, eq, type SQL, sql } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import * as v from "valibot"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { db } from "vite-hub/database/drizzle"
import { newLink } from "#shared/links"
import { COMMENT_IMAGE_TYPES, MAX_COMMENT_IMAGES, MAX_FILE_BYTES } from "#shared/schemas"
import type { CommentAttachment } from "#shared/types"
import { textValue } from "#shared/utils/text"
import { commentAttachments, drops } from "../databases/config"
import { type DropRow, deleteDrop, findDrop, storageFailure } from "./drops"
import { withDropQuota } from "./quotas"

/**
 * Images in comments. Each one is an image drop under the drop the comment is on, owned by that drop's owner, like a
 * doc's attachment: it shares the drop's sharing, lifetime, and Trash, stays out of lists and search, and takes no
 * plan slot (its bytes count). `comment_attachments` says which thread (by its first comment) or reply it belongs to.
 * Deleting the thread or the reply deletes its images.
 */

type ImageType = (typeof COMMENT_IMAGE_TYPES)[number]
export type CommentImage = { bytes: Uint8Array; contentType: ImageType; filename: string }

const EXTENSIONS: Record<ImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

/** The image's real type from its first bytes, whatever the browser claimed. */
function imageType(bytes: Uint8Array): ImageType | null {
  const type = detectContentType(bytes)
  return COMMENT_IMAGE_TYPES.find((known) => known === type) ?? null
}

/** The most a comment's multipart body may weigh: its images, a screenshot, and the JSON beside them. */
const MAX_COMMENT_FORM_BYTES = (MAX_COMMENT_IMAGES + 1) * MAX_FILE_BYTES + 64 * 1024

export async function readForm(event: H3Event) {
  if (Number(event.req.headers.get("content-length") ?? 0) > MAX_COMMENT_FORM_BYTES)
    throw new HTTPError({ status: 413, statusText: `Send at most ${MAX_COMMENT_IMAGES} images of 4 MiB each.` })
  try {
    return await event.req.formData()
  } catch {
    throw new HTTPError({ status: 400, statusText: "Send the comment as multipart form data." })
  }
}

/** The `image` files of a comment's form: at most MAX_COMMENT_IMAGES, each checked by its bytes and at most 4 MiB. */
export async function imagesOf(form: FormData): Promise<CommentImage[]> {
  const files = form.getAll("image")
  if (files.length > MAX_COMMENT_IMAGES)
    throw new HTTPError({ status: 400, statusText: `A comment takes at most ${MAX_COMMENT_IMAGES} images.` })
  const images: CommentImage[] = []
  for (const file of files) {
    if (!(file instanceof File)) throw new HTTPError({ status: 400, statusText: "Each image must be a file." })
    if (file.size > MAX_FILE_BYTES)
      throw new HTTPError({ status: 413, statusText: `${file.name || "An image"} exceeds the 4 MiB limit.` })
    const bytes = new Uint8Array(await file.arrayBuffer())
    const contentType = imageType(bytes)
    if (!contentType) throw new HTTPError({ status: 400, statusText: "Images must be PNG, JPEG, WebP, or GIF." })
    const base =
      (file.name || "image")
        .replace(/\.[^.]*$/, "")
        .replace(/[^\w .-]+/g, "")
        .trim()
        .slice(0, 80) || "image"
    images.push({ bytes, contentType, filename: `${base}.${EXTENSIONS[contentType]}` })
  }
  return images
}

/**
 * A comment or reply body: JSON as before, or multipart with the JSON in `data` and up to MAX_COMMENT_IMAGES `image`
 * files. `schema` checks the JSON either way.
 */
export async function readCommentBody<T extends v.GenericSchema>(
  event: H3Event,
  schema: T,
): Promise<{ input: v.InferOutput<T>; images: CommentImage[] }> {
  const multipart = event.req.headers.get("content-type")?.startsWith("multipart/form-data")
  const form = multipart ? await readForm(event) : null
  let data: unknown
  try {
    data = form ? JSON.parse(textValue(form.get("data")) ?? "") : await event.req.json()
  } catch {
    throw new HTTPError({ status: 400, statusText: "The comment is missing." })
  }
  const parsed = v.safeParse(schema, data)
  if (!parsed.success) throw new HTTPError({ status: 400, statusText: parsed.issues[0].message })
  return { input: parsed.output, images: form ? await imagesOf(form) : [] }
}

/** An image of `parent`'s, stored as `key`: private, since it follows its parent's sharing. */
export function imageDrop(
  parent: Pick<DropRow, "id" | "ownerId" | "teamId">,
  image: { key: string; contentType: string; size: number; filename: string; title: string; note?: string | null },
  actorName: string,
  now = Date.now(),
): DropRow {
  return {
    id: newLink(),
    ownerId: parent.ownerId,
    kind: "image",
    title: image.title.slice(0, 160),
    filename: image.filename,
    blobKey: image.key,
    contentType: image.contentType,
    size: image.size,
    version: 1,
    slug:
      image.filename
        .replace(/\.[^.]*$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "image",
    share: "private",
    publicUntil: null,
    teamFolder: false,
    shareReview: null,
    quarantinedAt: null,
    actorKind: "browser",
    actorName,
    agent: null,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    lifetime: "review",
    keepReason: null,
    note: image.note ?? null,
    trashedAt: null,
    trashReason: null,
    parentId: parent.id,
    siteUrl: null,
    publishToken: null,
    teamId: parent.teamId,
    resources: null,
  }
}

/**
 * Where a comment's images live: the drop it's on, or the site a screenshot came from, so a site's images are all
 * its own children. A folder holds drops, not attachments, so it takes none.
 */
export async function imageParent(drop: DropRow) {
  if (drop.kind === "folder") throw new HTTPError({ status: 400, statusText: "Comments on folders take no images." })
  if (drop.kind === "image" && drop.parentId) {
    const parent = await findDrop(drop.parentId)
    if (parent?.kind === "site") return parent
  }
  return drop
}

/**
 * Stores `images` under `parent` for the thread whose first comment is `commentId` (and reply `replyId`, when they're a
 * reply's). The parent's owner pays for the bytes, as for a site's screenshots. When anything fails, the blobs go and
 * nothing points at them.
 */
export async function attachImages(
  parent: DropRow,
  images: CommentImage[],
  owner: { commentId: string; replyId: string | null; n: number },
  actorName: string,
): Promise<CommentAttachment[]> {
  if (!images.length) return []
  const bytes = images.reduce((sum, image) => sum + image.bytes.byteLength, 0)
  return withDropQuota(parent.ownerId, { drops: 0, bytes, writes: 1 }, undefined, async (quota) => {
    const now = Date.now()
    const rows = images.map((image) =>
      imageDrop(
        parent,
        {
          key: `${crypto.randomUUID()}.${EXTENSIONS[image.contentType]}`,
          contentType: image.contentType,
          size: image.bytes.byteLength,
          filename: image.filename,
          title: `${image.filename} in comment #${owner.n}`,
        },
        actorName,
        now,
      ),
    )
    const stored: string[] = []
    try {
      for (const [index, row] of rows.entries()) {
        const image = images[index]!
        const [storageError] = await blob.put(row.blobKey!, image.bytes, {
          access: "private",
          contentType: image.contentType,
        })
        if (storageError) throw storageFailure(storageError)
        stored.push(row.blobKey!)
      }
      await quota.commit([
        db.insert(drops).values(rows),
        db.insert(commentAttachments).values(
          rows.map((row, index) => ({
            dropId: row.id,
            commentId: owner.commentId,
            replyId: owner.replyId,
            // Apart by a millisecond, so they keep the order they were sent in.
            createdAt: now + index,
          })),
        ),
      ])
    } catch (error) {
      if (stored.length) await blob.del(stored)
      throw error
    }
    return rows.map(toAttachment)
  })
}

export const toAttachment = (row: Pick<DropRow, "id" | "filename" | "contentType" | "size" | "blobKey">) => ({
  id: row.id,
  filename: row.filename,
  contentType: row.contentType ?? "image/png",
  size: row.size,
  url: `/f/${row.blobKey}`,
})

/**
 * Runs `write` (which adds a comment or a reply), then stores its images. If they can't be stored, `undo` removes what
 * `write` added, so a retry doesn't post it twice.
 */
export async function withImages<T extends { id: string }>(
  images: CommentImage[],
  write: () => Promise<T>,
  attach: (row: T) => Promise<CommentAttachment[]>,
  undo: (row: T) => Promise<unknown>,
): Promise<{ row: T; attachments: CommentAttachment[] }> {
  const row = await write()
  if (!images.length) return { row, attachments: [] }
  try {
    return { row, attachments: await attach(row) }
  } catch (error) {
    await undo(row)
    throw error
  }
}

/**
 * The comment images stored under the drops `parents` selects (a subquery, or one id), oldest first. A comment's images
 * live under the drop it's on, or under the site a screenshot came from (imageParent), so this reads a list's images
 * without its comment ids, beside its threads.
 */
export const attachmentsUnder = (parents: SQL) =>
  db
    .select({
      commentId: commentAttachments.commentId,
      replyId: commentAttachments.replyId,
      id: drops.id,
      filename: drops.filename,
      contentType: drops.contentType,
      size: drops.size,
      blobKey: drops.blobKey,
    })
    .from(commentAttachments)
    .innerJoin(drops, eq(drops.id, commentAttachments.dropId))
    .where(sql`${drops.parentId} IN (${parents})`)
    .orderBy(asc(commentAttachments.createdAt))

/** Deletes the images of a thread (its first comment's and its replies') or of one reply, before the comment goes. */
export async function deleteImagesOf(target: { commentId: string } | { replyId: string }) {
  const rows = await db
    .select({ id: commentAttachments.dropId })
    .from(commentAttachments)
    .where(
      "commentId" in target
        ? eq(commentAttachments.commentId, target.commentId)
        : eq(commentAttachments.replyId, target.replyId),
    )
  for (const { id } of rows) {
    const row = await findDrop(id)
    if (row) await deleteDrop(row)
  }
}
