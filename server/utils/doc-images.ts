import { and, desc, eq, isNotNull, sql } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import * as v from "valibot"
import { blob, detectContentType } from "vite-hub/blob"
import { db } from "vite-hub/database"
import { ACTOR_KINDS } from "#shared/types"
import { MAX_FILE_BYTES } from "#shared/schemas"
import { drops } from "../databases/default/index"
import { imageDrop } from "./comment-images"
import { type DropRow, findDrop, permissions, storageFailure } from "./drops"
import type { Identity } from "./identity"
import { withDropQuota } from "./quotas"
import { seal, unseal } from "./review"

export const MAX_DOC_IMAGES = 30
const UPLOAD_MINUTES = 15
const IMAGE_NAME = /^[^/\\\s"'()<>{}[\]]+\.(?:png|jpe?g|gif|webp|avif|svg)$/

export const DocImagesInput = v.pipe(
  v.array(
    v.object({
      name: v.pipe(
        v.string(),
        v.maxLength(100),
        v.regex(
          IMAGE_NAME,
          "An image's name is a file name with no folders or spaces, ending in .png, .jpg, .gif, .webp, .avif, or .svg.",
        ),
        v.description("The image's file name as the Markdown writes it after ./, e.g. A.png for ![](./A.png)."),
      ),
    }),
  ),
  v.maxLength(
    MAX_DOC_IMAGES,
    `A publish attaches at most ${MAX_DOC_IMAGES} images. Publish the rest with previous: the doc keeps the images it has.`,
  ),
  v.description(
    `With a Markdown doc (markdown, or file with a .md name): up to ${MAX_DOC_IMAGES} images that live and expire with it, in one publish. The Markdown writes each as ./<name>, as in ![alt](./A.png) or ::screenshot{src="./A.png"}, and Drop stores it with that address replaced by the image's fileUrl. The reply lists each image's uploadUrl: upload it with \`curl -T <path to A.png> '<uploadUrl>'\` within 15 minutes, once. With previous, ./<name> also finds the images the doc already has, so pass only new or changed ones.`,
  ),
)

const ImageTicket = v.object({
  u: v.string(),
  k: v.picklist(ACTOR_KINDS),
  a: v.string(),
  d: v.string(),
  n: v.string(),
  b: v.string(),
  j: v.string(),
  e: v.number(),
})

export type DocImage = { name: string; key: string; fileUrl: string }

export function planImages(names: { name: string }[], origin: string): DocImage[] {
  const seen = new Set<string>()
  return names.map(({ name }) => {
    if (seen.has(name)) throw new HTTPError({ status: 400, message: `images names ${name} twice; name each once.` })
    seen.add(name)
    const key = `${crypto.randomUUID()}${name.match(/\.[a-z]+$/)![0]}`
    return { name, key, fileUrl: new URL(`/f/${key}`, origin).href }
  })
}

const notCommentImage = sql`NOT EXISTS (SELECT 1 FROM comment_attachments WHERE comment_attachments.drop_id = ${drops.id})`

export async function attachedImages(doc: Pick<DropRow, "id">, origin: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ filename: drops.filename, blobKey: drops.blobKey })
    .from(drops)
    .where(
      and(
        eq(drops.parentId, doc.id),
        eq(drops.kind, "image"),
        isNotNull(drops.blobKey),
        eq(drops.draftImage, false),
        notCommentImage,
      ),
    )
    .orderBy(desc(drops.createdAt))
    .limit(200)
  const found = new Map<string, string>()
  for (const row of rows)
    if (!found.has(row.filename)) found.set(row.filename, new URL(`/f/${row.blobKey}`, origin).href)
  return found
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const RELATIVE = /(?<=[("'=<]|\]:[ \t]+)\.\/([^\s"'()<>{}[\]]+)/g
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg)$/i

export function linkImages(markdown: string, files: Map<string, string>) {
  const missing = new Set<string>()
  let fence: string | null = null
  const lines = markdown.split("\n").map((line) => {
    const open = line.match(FENCE)?.[1]
    if (fence) {
      if (
        open &&
        open[0] === fence[0] &&
        open.length >= fence.length &&
        !line.slice(line.indexOf(open) + open.length).trim()
      )
        fence = null
      return line
    }
    if (open) {
      fence = open
      return line
    }
    return line
      .split(/(`+[^`]*`+)/)
      .map((part, index) =>
        index % 2
          ? part
          : part.replace(RELATIVE, (reference, name: string) => {
              let decoded = name
              try {
                decoded = decodeURIComponent(name)
              } catch {}
              const url = files.get(name) ?? files.get(decoded)
              if (url) return url
              if (IMAGE_FILE.test(decoded)) missing.add(decoded)
              return reference
            }),
      )
      .join("")
  })
  return { markdown: lines.join("\n"), missing: [...missing] }
}

export async function signImageUpload(
  event: H3Event,
  who: Identity,
  doc: Pick<DropRow, "id">,
  image: DocImage,
  now = Date.now(),
) {
  const ticket = {
    u: who.userId,
    k: who.actorKind,
    a: who.actorName,
    d: doc.id,
    n: image.name,
    b: image.key,
    j: crypto.randomUUID(),
    e: now + UPLOAD_MINUTES * 60_000,
  }
  const sealed = await seal(event, "image", ticket)
  return {
    name: image.name,
    uploadUrl: new URL(`/api/uploads/images/${sealed}`, event.url.origin).href,
    fileUrl: image.fileUrl,
    method: "PUT" as const,
    expiresAt: new Date(ticket.e).toISOString(),
  }
}

export async function readImageUpload(event: H3Event, sealed: string, now = Date.now()) {
  const ticket = await unseal(event, "image", ImageTicket, sealed)
  if (!ticket || ticket.e <= now) return null
  return ticket
}

export async function storeDocImage(
  who: Identity,
  ticket: v.InferOutput<typeof ImageTicket>,
  bytes: Uint8Array,
  event: H3Event,
) {
  if (bytes.byteLength > MAX_FILE_BYTES)
    throw new HTTPError({ status: 413, statusText: "The image exceeds the 4 MiB limit." })
  const contentType = detectContentType(bytes)
  if (!contentType?.startsWith("image/"))
    throw new HTTPError({
      status: 415,
      statusText: `${ticket.n} isn't an image. Upload a PNG, JPEG, GIF, WebP, AVIF, or SVG.`,
    })
  const doc = await findDrop(ticket.d, event)
  if (!doc || doc.expired || doc.kind !== "markdown" || !permissions(doc, who).edit)
    throw new HTTPError({ status: 404, statusText: "The doc this image belongs to is gone. Publish it again." })
  const owner = doc.raw ?? doc
  const [taken] = await db.select({ id: drops.id }).from(drops).where(eq(drops.blobKey, ticket.b)).limit(1)
  if (taken) throw usedImageUpload()
  return withDropQuota(owner.ownerId, { drops: 0, bytes: bytes.byteLength, writes: 1 }, event, async (quota) => {
    const [storageError] = await blob.put(ticket.b, bytes, { contentType })
    if (storageError) throw storageFailure(storageError)
    const row: DropRow = {
      ...imageDrop(
        owner,
        { key: ticket.b, contentType, size: bytes.byteLength, filename: ticket.n, title: ticket.n },
        who.actorName,
      ),
      actorKind: who.actorKind,
    }
    await quota.commit([db.insert(drops).values(row)])
    return row
  })
}

export const usedImageUpload = () =>
  new HTTPError({
    status: 409,
    statusText: "This image's upload URL was already used. Publish the doc with previous and images for a new one.",
  })
