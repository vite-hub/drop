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

type ImageType = (typeof COMMENT_IMAGE_TYPES)[number]
export type CommentImage = { bytes: Uint8Array; contentType: ImageType; filename: string }

const EXTENSIONS: Record<ImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

function imageType(bytes: Uint8Array): ImageType | null {
  const type = detectContentType(bytes)
  return COMMENT_IMAGE_TYPES.find((known) => known === type) ?? null
}

function imageName(name: string, contentType: ImageType) {
  const base =
    (name || "image")
      .replace(/\.[^.]*$/, "")
      .replace(/[^\w .-]+/g, "")
      .trim()
      .slice(0, 80) || "image"
  return `${base}.${EXTENSIONS[contentType]}`
}

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

export function requireSender(who: Identity | null, as: string | undefined) {
  if (as !== undefined && as !== who?.userId)
    throw new HTTPError({ status: 401, statusText: "Sign in again to send this comment." })
}

export async function refuseSend(event: H3Event, who: Identity | null, refusal: HTTPError): Promise<never> {
  const multipart = event.req.headers.get("content-type")?.startsWith("multipart/form-data")
  const data: unknown = await (
    multipart ? readForm(event).then((form) => JSON.parse(textValue(form.get("data")) ?? "")) : event.req.json()
  ).catch(() => null)
  const as = v.safeParse(v.object({ as: v.string() }), data)
  requireSender(who, as.success ? as.output.as : undefined)
  throw refusal
}

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
    sessionPublisherId: null,
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
    draftImage: false,
    teamId: parent.teamId,
    resources: null,
  }
}

export async function imageParent(drop: DropRow) {
  if (drop.kind === "folder") throw new HTTPError({ status: 400, statusText: "Comments on folders take no images." })
  if (drop.kind === "image" && drop.parentId) {
    const parent = await findDrop(drop.parentId)
    if (parent?.kind === "site") return parent
  }
  return drop
}

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
        db
          .insert(commentAttachments)
          .values(rows.map((row, index) => ({ dropId: row.id, commentId: "", replyId: null, createdAt: now + index }))),
      ])
    } catch (error) {
      if (stored.length) await blob.delete(stored)
      throw error
    }
    return rows
  })
}

async function linkImages(ids: string[], owner: { commentId: string; replyId: string | null }) {
  if (!ids.length) return
  await db.update(commentAttachments).set(owner).where(inArray(commentAttachments.dropId, ids))
}

export const toAttachment = (row: Pick<DropRow, "id" | "filename" | "contentType" | "size">) => ({
  id: row.id,
  filename: row.filename,
  contentType: row.contentType ?? "image/png",
  size: row.size,
  url: commentAttachmentUrl(row.id),
})

export async function withImages<T extends { id: string }>(
  parent: DropRow | null,
  images: CommentImage[],
  actorName: string,
  write: (attachments: string[]) => Promise<T>,
  owner: (row: T, attachments: string[]) => { commentId: string; replyId: string | null } | null,
): Promise<{ row: T; attachments: CommentAttachment[] | null }> {
  const stored = parent ? await storeImages(parent, images, actorName) : []
  const ids = stored.map((row) => row.id)
  let row: T
  try {
    row = await write(ids)
  } catch (error) {
    await deleteImages(ids)
    throw error
  }
  const link = owner(row, ids)
  if (!link) {
    await deleteImages(ids)
    return { row, attachments: null }
  }
  await linkImages(ids, link)
  return { row, attachments: stored.map(toAttachment) }
}

export const lists = (message: { attachments: readonly string[] } | undefined, ids: string[]) =>
  ids.every((id) => message?.attachments.includes(id))

export async function attachmentsById(ids: readonly string[]): Promise<Map<string, CommentAttachment>> {
  if (!ids.length) return new Map()
  const rows = await db
    .select({ id: drops.id, filename: drops.filename, contentType: drops.contentType, size: drops.size })
    .from(commentAttachments)
    .innerJoin(drops, eq(drops.id, commentAttachments.dropId))
    .where(inArray(drops.id, [...ids]))
  return new Map(rows.map((row) => [row.id, toAttachment(row)]))
}

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

export async function storePageImage(file: { name: string; size: number; data: Uint8Array }): Promise<string> {
  if (file.size > MAX_FILE_BYTES)
    throw new HTTPError({ status: 413, statusText: `${file.name} exceeds the 4 MiB limit.` })
  const contentType = imageType(file.data)
  if (!contentType) throw new HTTPError({ status: 400, statusText: "Images must be PNG, JPEG, WebP, or GIF." })
  const key = `comments/page/${crypto.randomUUID()}/${imageName(file.name, contentType)}`
  const [error] = await blob.put(key, file.data, { contentType })
  if (error) throw storageFailure(error)
  return key
}

const PAGE_IMAGE_KEY =
  /^comments\/page\/[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}\/[\w .-]{1,84}\.(png|jpg|webp|gif)$/

export function pageImageType(key: string): ImageType | null {
  const extension = PAGE_IMAGE_KEY.exec(key)?.[1]
  return COMMENT_IMAGE_TYPES.find((type) => EXTENSIONS[type] === extension) ?? null
}

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

export async function deleteImages(ids: readonly string[]) {
  for (const id of ids) {
    const row = await findDrop(id)
    if (row) await deleteDrop(row)
  }
}
