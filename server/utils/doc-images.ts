import { createMarkdownParser, type ComarkPlugin, type MarkdownExitPlugin, type Node } from "@comark/html/parse"
import attributes from "@comark/html/plugins/attributes"
import components from "@comark/html/plugins/components"
import frontmatter from "@comark/html/plugins/frontmatter"
import { and, desc, eq, isNotNull, sql } from "drizzle-orm"
import { type H3Event, HTTPError } from "h3"
import * as v from "valibot"
import { blob, detectContentType } from "vite-hub/blob"
import { db } from "vite-hub/database"
import { ACTOR_KINDS } from "#shared/types"
import { MAX_FILE_BYTES } from "#shared/schemas"
import { blobCleanup, drops } from "../databases/default/index"
import { imageDrop } from "./comment-images"
import { type DropRow, findDrop, permissions, storageFailure } from "./drops"
import { deleteBlobKeys } from "./drops/write"
import type { Identity } from "./identity"
import { withDropQuota } from "./quotas"
import { seal, unseal } from "./review"

const MAX_DOC_IMAGES = 30
const UPLOAD_MINUTES = 15
const IMAGE_NAME = /^[^/\\\s"'()<>{}[\]]+\.(?:png|jpe?g|gif|webp)$/
const IMAGE_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
])

export const DocImagesInput = v.pipe(
  v.array(
    v.object({
      name: v.pipe(
        v.string(),
        v.maxLength(100),
        v.regex(
          IMAGE_NAME,
          "An image's name is a file name with no folders or spaces, ending in .png, .jpg, .jpeg, .gif, or .webp. Convert other formats to one of these first.",
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
  r: v.number(),
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
    .orderBy(desc(drops.parentVersion), desc(drops.createdAt), desc(drops.id))
  const found = new Map<string, string>()
  for (const row of rows)
    if (!found.has(row.filename)) found.set(row.filename, new URL(`/f/${row.blobKey}`, origin).href)
  return found
}

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|svg)$/i
const RELATIVE = /\.\/([^\s"'()<>{}[\]`]+)/g
const URL_ATTRIBUTES = new Set(["href", "src", "poster", "url"])

const collectReferences: MarkdownExitPlugin = (parser) => {
  parser.core.ruler.push("drop-image-references", (state) => {
    if (!state.env.references) return
    const token = new state.Token("drop_image_references", "", 0)
    token.meta = Object.values(state.env.references)
    state.tokens.push(token)
  })
}
const referencePlugin: ComarkPlugin<{ imageReferences: unknown[] }> = {
  name: "drop-image-references",
  markdownItPlugins: [collectReferences],
  post({ tokens, tree }) {
    const last = tokens.at(-1)
    tree.meta.imageReferences = last?.type === "drop_image_references" ? last.meta : []
  },
}
const parseImageDestinations = createMarkdownParser({
  registerDefaultPlugins: false,
  plugins: [frontmatter(), components(), attributes(), referencePlugin],
})

export async function linkImages(markdown: string, files: Map<string, string>) {
  const candidates = new Map<string, { start: number; end: number; name: string; url?: string }>()
  const nonce = crypto.randomUUID()
  const probe = markdown.replace(RELATIVE, (reference, name: string, start: number) => {
    let decoded = name
    try {
      decoded = decodeURIComponent(name)
    } catch {}
    const url = files.get(name) ?? files.get(decoded)
    if (!url && !IMAGE_FILE.test(decoded)) return reference
    const marker = `./drop-image-${nonce}-${candidates.size}.png`
    candidates.set(marker, { start, end: start + reference.length, name: decoded, url })
    return marker
  })
  if (!candidates.size) return { markdown, missing: [] }

  const tree = await parseImageDestinations(probe)
  const selected = new Set<string>()
  const select = (value: unknown) => {
    if (typeof value === "string" && candidates.has(value)) selected.add(value)
  }
  const nodes: Node[] = [...tree.nodes]
  while (nodes.length) {
    const node = nodes.pop()
    if (!Array.isArray(node)) continue
    const [, props, ...children] = node
    for (const [key, value] of Object.entries(props)) if (URL_ATTRIBUTES.has(key)) select(value)
    for (const child of children) nodes.push(child)
  }
  for (const reference of tree.meta.imageReferences) {
    if (reference && typeof reference === "object" && "href" in reference) select(reference.href)
  }

  const missing = new Set<string>()
  const output: string[] = []
  let cursor = 0
  for (const [marker, { start, end, name, url }] of candidates) {
    if (!selected.has(marker)) continue
    if (!url) missing.add(name)
    else {
      output.push(markdown.slice(cursor, start), url)
      cursor = end
    }
  }
  output.push(markdown.slice(cursor))
  return { markdown: output.join(""), missing: [...missing] }
}

export async function signImageUpload(
  event: H3Event,
  who: Identity,
  doc: Pick<DropRow, "id" | "version">,
  image: DocImage,
  now = Date.now(),
) {
  const ticket = {
    u: who.userId,
    k: who.actorKind,
    a: who.actorName,
    d: doc.id,
    r: doc.version,
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
  if (!contentType || contentType !== IMAGE_TYPES.get(ticket.n.split(".").at(-1)!))
    throw new HTTPError({
      status: 415,
      statusText: `${ticket.n} isn't an image matching its file extension. Upload a PNG, JPEG, GIF, or WebP.`,
    })
  const doc = await findDrop(ticket.d, event)
  if (!doc || doc.expired || doc.kind !== "markdown" || !permissions(doc, who).edit)
    throw new HTTPError({ status: 404, statusText: "The doc this image belongs to is gone. Publish it again." })
  const owner = doc.raw ?? doc
  const [taken] = await db.select({ id: drops.id }).from(drops).where(eq(drops.blobKey, ticket.b)).limit(1)
  if (taken) throw usedImageUpload()
  return withDropQuota(
    owner.ownerId,
    { drops: 0, bytes: bytes.byteLength, writes: 1, docImage: true },
    event,
    async (quota) => {
      const pendingCleanup = () =>
        db.select({ key: blobCleanup.blobKey }).from(blobCleanup).where(eq(blobCleanup.blobKey, ticket.b))
      if ((await pendingCleanup()).length) {
        await deleteBlobKeys([ticket.b])
        if ((await pendingCleanup()).length) throw storageFailure("Image cleanup is still pending.")
      }
      const [storageError] = await blob.put(ticket.b, bytes, { contentType })
      if (storageError) throw storageFailure(storageError)
      const row: DropRow = {
        ...imageDrop(
          owner,
          { key: ticket.b, contentType, size: bytes.byteLength, filename: ticket.n, title: ticket.n },
          who.actorName,
        ),
        actorKind: who.actorKind,
        parentVersion: ticket.r,
      }
      try {
        await quota.commit([db.insert(drops).values(row)])
      } catch (error) {
        await deleteBlobKeys([ticket.b])
        throw error
      }
      return row
    },
  )
}

export const usedImageUpload = () =>
  new HTTPError({
    status: 409,
    statusText: "This image's upload URL was already used. Publish the doc with previous and images for a new one.",
  })
