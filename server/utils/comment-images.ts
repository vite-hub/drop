import { asc, eq, inArray, type SQL, sql } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import * as v from "valibot"
import { blob, detectContentType } from "vite-hub/blob"
import { db } from "vite-hub/database"
import { newLink } from "#shared/links"
import { COMMENT_IMAGE_TYPES, MAX_COMMENT_IMAGES, MAX_FILE_BYTES } from "#shared/schemas"
import type { CommentSubject } from "vite-hub/comments"
import { commentAttachmentUrl } from "vite-hub/comments/client"
import type { CommentAttachment } from "#shared/types"
import { textValue } from "#shared/utils/text"
import { commentAttachments, drops } from "../databases/default/index"
import { type DropRow, deleteDrop, findDrop, permissions, storageFailure } from "./drops"
import type { Identity } from "./identity"
import { withDropQuota } from "./quotas"

/**
 * Images in comments. Each one is an image drop under the drop the comment is on, owned by that drop's owner, like a
 * doc's attachment: it shares the drop's sharing, lifetime, and Trash, stays out of lists and search, and takes no
 * plan slot (its bytes count). The message it's in lists its id in `attachments`; `comment_attachments` marks it a
 * comment's image and says which thread (by its first message) or reply it belongs to. Deleting the thread or the reply
 * deletes its images.
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

/** A safe name for an image, with the extension of its real type. */
function imageName(name: string, contentType: ImageType) {
  const base =
    (name || "image")
      .replace(/\.[^.]*$/, "")
      .replace(/[^\w .-]+/g, "")
      .trim()
      .slice(0, 80) || "image"
  return `${base}.${EXTENSIONS[contentType]}`
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
    images.push({ bytes, contentType, filename: imageName(file.name, contentType) })
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
 * Stores `images` under `parent` as image drops, before the comment or reply they go in exists, so their ids can be its
 * `attachments`. The parent's owner pays for the bytes, as for a site's screenshots. A `comment_attachments` row marks
 * each one a comment's image from the start, which keeps it out of lists and search; `linkImages` then says whose it
 * is. When anything fails, the blobs go and nothing points at them.
 */
async function storeImages(parent: DropRow, images: CommentImage[], actorName: string): Promise<DropRow[]> {
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
          title: `${image.filename} in a comment`,
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
          contentType: image.contentType,
        })
        if (storageError) throw storageFailure(storageError)
        stored.push(row.blobKey!)
      }
      await quota.commit([
        db.insert(drops).values(rows),
        db.insert(commentAttachments).values(
          // Apart by a millisecond, so they keep the order they were sent in. Not anyone's until linkImages.
          rows.map((row, index) => ({ dropId: row.id, commentId: "", replyId: null, createdAt: now + index })),
        ),
      ])
    } catch (error) {
      if (stored.length) await blob.delete(stored)
      throw error
    }
    return rows
  })
}

/** Says which thread (by its first message) or reply the stored images are in. */
async function linkImages(ids: string[], owner: { commentId: string; replyId: string | null }) {
  if (!ids.length) return
  await db.update(commentAttachments).set(owner).where(inArray(commentAttachments.dropId, ids))
}

/** A comment image as Drop's API answers it. ViteHub Comments serves its file (`readAttachment` in server/comments.ts). */
export const toAttachment = (row: Pick<DropRow, "id" | "filename" | "contentType" | "size">) => ({
  id: row.id,
  filename: row.filename,
  contentType: row.contentType ?? "image/png",
  size: row.size,
  url: commentAttachmentUrl(row.id),
})

/**
 * Stores the images, then runs `write` (which adds a comment or a reply that lists them in `attachments`), then links
 * them to it. If `write` fails, the images go, so a retry doesn't leave them behind.
 */
export async function withImages<T extends { id: string }>(
  parent: DropRow | null,
  images: CommentImage[],
  actorName: string,
  write: (attachments: string[]) => Promise<T>,
  owner: (row: T) => { commentId: string; replyId: string | null },
): Promise<{ row: T; attachments: CommentAttachment[] }> {
  const stored = parent ? await storeImages(parent, images, actorName) : []
  const ids = stored.map((row) => row.id)
  let row: T
  try {
    row = await write(ids)
  } catch (error) {
    await deleteImages(ids)
    throw error
  }
  await linkImages(ids, owner(row))
  return { row, attachments: stored.map(toAttachment) }
}

/**
 * A file sent through ViteHub's surfaces (`comments.upload`) for a thread on a drop or a site: checked by its bytes,
 * like a Drop comment's images, and stored the same way. Returns the image drop's id, which the message keeps.
 */
export async function storeCommentFile(
  file: { name: string; size: number; data: Uint8Array },
  subject: CommentSubject | undefined,
  who: Identity | null,
): Promise<string> {
  const drop = subject && (subject.kind === "drop" || subject.kind === "site") ? await findDrop(subject.id) : null
  if (!drop || !permissions(drop, who).comment)
    throw new HTTPError({ status: 404, statusText: "You can't comment on this drop." })
  if (file.size > MAX_FILE_BYTES)
    throw new HTTPError({ status: 413, statusText: `${file.name} exceeds the 4 MiB limit.` })
  const contentType = imageType(file.data)
  if (!contentType) throw new HTTPError({ status: 400, statusText: "Images must be PNG, JPEG, WebP, or GIF." })
  const [row] = await storeImages(
    await imageParent(drop),
    [{ bytes: file.data, contentType, filename: imageName(file.name, contentType) }],
    who?.name ?? "Guest",
  )
  return row!.id
}

/**
 * The comment images stored under the drops `parents` selects (a subquery, or one id), oldest first. A comment's images
 * live under the drop it's on, or under the site a screenshot came from (imageParent), so this reads a list's images
 * beside its threads; their messages name them by id.
 */
export const attachmentsUnder = (parents: SQL) =>
  db
    .select({
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

/** Deletes comment images by their ids: a thread's or a reply's `attachments`. */
export async function deleteImages(ids: readonly string[]) {
  for (const id of ids) {
    const row = await findDrop(id)
    if (row) await deleteDrop(row)
  }
}
