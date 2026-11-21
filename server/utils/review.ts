import type { AgentMetadata } from "#shared/agent"
import { writtenBy } from "#shared/agents"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { defineHandler, type H3Event, HTTPError } from "h3"
import * as v from "valibot"
import { hex, sha256 } from "#shared/utils/bytes"
import { textValue } from "#shared/utils/text"
import { blob, detectContentType } from "vite-hub/blob"
import { commentsSchema } from "vite-hub/comments/database"
import { db } from "vite-hub/database"
import { useServerEnv } from "vite-hub/env"
import { seal as sealValue, unseal as unsealValue } from "vite-hub/env/server"
import { newLink, slugify } from "#shared/links"
import {
  isSitePattern,
  REVIEW_TOKEN_HOURS,
  SITE_ADDRESS_RULE,
  siteAddress,
  siteAddressesFor,
  siteHost,
  siteMatches,
} from "#shared/review"
import { MAX_FILE_BYTES, type ReviewCommentInput, ReviewCommentSchema } from "#shared/schemas"
import type { CommentAttachment, ReviewThread, SiteReviewItem } from "#shared/types"
import { defaultShare, isPublic, type Share } from "#shared/share"
import { drops, reviewSubmissions, user } from "../databases/default/index"
import { type CommentImage, imageDrop, imagesOf, readForm, withImages } from "./comment-images"
import {
  addThread,
  authorOf,
  type DropThread,
  findThread,
  type Reader,
  readerOf,
  removeThread,
  siteCommentList,
  threadsFor,
  toComment,
} from "./comments"
import { guestIdOf } from "./guests"
import { siteCoversDrop } from "./content-origin"
import { isExpired, expiryPolicy, renewDrop } from "./expiry"
import { createFolder } from "./folders"
import {
  deleteDrop,
  type DropRow,
  findDrop,
  findDropByRef,
  type LifetimeInput,
  lifetimeFields,
  permissions,
  storageFailure,
} from "./drops"
import { type Identity, roleOf } from "./identity"
import { logDrop } from "./logs"
import { isMember, membersOnly } from "./members"
import { DropQuotaError, requireKeepSlot, withDropQuota } from "./quotas"
import { modeFor, shareFields } from "./share"
import { shareReviewFor } from "./trust"
import { touchFolder, uniqueSlug } from "./nodes"
import { findableBy } from "./related"

const ReviewClaims = v.object({
  d: v.string(),
  u: v.nullable(v.string()),
  n: v.string(),
  o: v.string(),
  e: v.number(),
  g: v.optional(v.pipe(v.string(), v.startsWith("guest:"), v.maxLength(80))),
})
export type ReviewClaims = v.InferOutput<typeof ReviewClaims>

const Choice = v.object({ c: v.string(), o: v.string(), u: v.nullable(v.string()), e: v.number() })
type Choice = v.InferOutput<typeof Choice>

const encoder = new TextEncoder()

function authSecret(event: H3Event) {
  const secret = useServerEnv(event).auth?.secret?.unseal()
  if (!secret)
    throw new HTTPError({ status: 503, statusText: "Site review needs the auth secret (BETTER_AUTH_SECRET)." })
  return secret
}

export async function keyedName(event: H3Event, purpose: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    await sha256(encoder.encode(`${purpose}:${authSecret(event)}`)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)))
  return hex(mac.subarray(0, 16))
}

type SealPurpose = "token" | "choice" | "doc" | "upload" | "app-files" | "presence"

const sealRoot = async (event: H3Event) => hex(await sha256(encoder.encode(`review-token:${authSecret(event)}`)))

export async function seal(event: H3Event, purpose: SealPurpose, value: Readonly<Record<string, unknown>>) {
  return sealValue(`drop:${purpose}`, value, { secret: await sealRoot(event) })
}

export async function unseal<T extends v.GenericSchema>(
  event: H3Event,
  purpose: SealPurpose,
  schema: T,
  text: string,
  maxLength = 3072,
): Promise<v.InferOutput<T> | null> {
  if (text.length > maxLength) return null
  const [error, value] = await unsealValue(`drop:${purpose}`, text, { schema, secret: await sealRoot(event) })
  return error ? null : value
}

export async function signReviewToken(event: H3Event, claims: Omit<ReviewClaims, "e">, now = Date.now()) {
  const full: ReviewClaims = { ...claims, e: now + REVIEW_TOKEN_HOURS * 3_600_000 }
  return { token: await seal(event, "token", full), expiresAt: full.e }
}

export async function readReviewToken(event: H3Event, token: string, now = Date.now()): Promise<ReviewClaims | null> {
  const claims = await unseal(event, "token", ReviewClaims, token)
  return claims && claims.e > now ? claims : null
}

export const sealChoice = (
  event: H3Event,
  site: Pick<DropRow, "id">,
  origin: string,
  who: Identity | null,
  now = Date.now(),
) => seal(event, "choice", { c: site.id, o: origin, u: who?.userId ?? null, e: now + 600_000 } satisfies Choice)

export async function openChoice(event: H3Event, text: string, origin: string, who: Identity | null, now = Date.now()) {
  const choice = await unseal(event, "choice", Choice, text)
  return choice && choice.o === origin && choice.u === (who?.userId ?? null) && choice.e > now ? choice.c : null
}

function sitesCovering(origin: string) {
  const addresses = siteAddressesFor(origin)
  return addresses.length
    ? and(
        eq(drops.kind, "site"),
        inArray(drops.siteUrl, addresses),
        isNull(drops.trashedAt),
        isNull(drops.quarantinedAt),
      )
    : null
}

export async function sitesFor(origin: string, who: Identity | null, event?: H3Event) {
  const where = sitesCovering(origin)
  if (!where) return []
  const rows = await db
    .select({ id: drops.id, owner: user.name })
    .from(drops)
    .leftJoin(user, eq(user.id, drops.ownerId))
    .where(where)
    .orderBy(desc(drops.updatedAt))
    .limit(50)
  const found = await Promise.all(rows.map((row) => findDrop(row.id, event)))
  return found.flatMap((site, index) =>
    site?.kind === "site" && site.siteUrl && siteMatches(site.siteUrl, origin) && permissions(site, who).comment
      ? [{ site, owner: rows[index]!.owner ?? "" }]
      : [],
  )
}

async function siteForPage(address: string, who: Identity, event?: H3Event) {
  let url: URL
  try {
    url = new URL(address.trim())
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  const [found] = await sitesFor(url.origin, who, event)
  return found ? { site: found.site, page: reviewPage(found.site, url.origin, url.pathname) } : null
}

export async function findDropOrSite(ref: string, who: Identity, event: H3Event) {
  const drop = await findDropByRef(ref, event)
  if (drop) return { drop, page: null }
  const found = await siteForPage(ref, who, event)
  return { drop: found?.site ?? null, page: found?.page ?? null }
}

export const originOf = (page: string) => /^https?:\/\/[^/]+/.exec(page)?.[0] ?? page

export const mayResolveSite = (site: DropRow, who: Identity | null, wrote: boolean) =>
  wrote || permissions(site, who).manage || (who !== null && permissions(site, who).comment)

export async function covered(origin: string) {
  const where = sitesCovering(origin)
  return Boolean(where && (await db.select({ id: drops.id }).from(drops).where(where).limit(1)).length)
}

export function openable(site: DropRow, who: Identity | null) {
  const grants = (site.grants ?? [{ share: site.share }]).filter((grant) => !isPublic(grant.share))
  return permissions({ ...site, grants }, who).view
}

const DocHandle = v.object({ d: v.string(), e: v.number() })

export const sealDoc = (event: H3Event, doc: Pick<DropRow, "id">, until: number) =>
  seal(event, "doc", { d: doc.id, e: until } satisfies v.InferOutput<typeof DocHandle>)

export async function openDoc(event: H3Event, handle: string, who: Identity, now = Date.now()) {
  const claims = await unseal(event, "doc", DocHandle, handle)
  const doc = claims && claims.e > now ? await findDrop(claims.d, event) : null
  return doc && (await findableBy(who, [doc], event)).length ? doc : null
}

export async function reviewer(claims: Pick<ReviewClaims, "u">): Promise<Identity | null | false> {
  if (!claims.u) return membersOnly() ? false : null
  const [row] = await db.select().from(user).where(eq(user.id, claims.u)).limit(1)
  if (!row || row.banned) return false
  if (!(await isMember(row.id))) return false
  return {
    userId: row.id,
    name: row.name,
    email: row.email,
    image: row.image ?? null,
    role: roleOf(row),
    actorKind: "browser",
    actorName: row.name,
  }
}

export async function reviewSession(event: H3Event) {
  const origin = event.req.headers.get("origin") ?? ""
  event.res.headers.set("Vary", "Origin")
  event.res.headers.set("Cache-Control", "no-store")
  const token = event.req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1]
  const claims = token ? await readReviewToken(event, token) : null
  const site = claims && claims.o === origin ? await findDrop(claims.d, event) : null
  if (claims && site?.kind === "site" && site.siteUrl && siteMatches(site.siteUrl, origin)) {
    event.res.headers.set("Access-Control-Allow-Origin", origin)
    const who = await reviewer(claims)
    const guest = who || !token ? null : (claims.g ?? (await guestIdOf(token)))
    if (who !== false && permissions(site, who).comment) return { site, claims, who, guest }
  } else if (await covered(origin)) event.res.headers.set("Access-Control-Allow-Origin", origin)
  throw new HTTPError({ status: 401, statusText: "Your review session ended. Connect again to comment." })
}

export function reviewTiming(event: H3Event) {
  const start = performance.now()
  let last = start
  const steps: string[] = []
  return {
    step(name: string) {
      const now = performance.now()
      steps.push(`${name};dur=${(now - last).toFixed(1)}`)
      last = now
    },
    send() {
      steps.push(`total;dur=${(performance.now() - start).toFixed(1)}`)
      event.res.headers.set("Server-Timing", steps.join(", "))
      const origin = event.res.headers.get("access-control-allow-origin")
      if (!origin) return
      event.res.headers.set("Access-Control-Expose-Headers", "Server-Timing")
      event.res.headers.set("Timing-Allow-Origin", origin)
    },
  }
}

export async function reviewPreflight(event: H3Event) {
  const origin = event.req.headers.get("origin") ?? ""
  if (!(await covered(origin))) throw new HTTPError({ status: 404, statusText: "No site review here." })
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PATCH",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    },
  })
}

export const reviewPage = (site: Pick<DropRow, "siteUrl">, origin: string, page: string) =>
  site.siteUrl && isSitePattern(site.siteUrl) ? `${origin}${page}` : page

export function reviewApi(handler: (event: H3Event<any>) => Promise<unknown> | unknown) {
  return defineHandler(async (event) => {
    try {
      return await handler(event)
    } catch (error) {
      if (!HTTPError.isError(error)) throw error
      const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
      for (const name of ["access-control-allow-origin", "vary"]) {
        const value = event.res.headers.get(name)
        if (value) headers.set(name, value)
      }
      const body = error instanceof DropQuotaError ? error.quotaBody : { message: error.statusText || error.message }
      return new Response(JSON.stringify(body), { status: error.status, headers })
    }
  })
}

const SITE_REVIEWS_SLUG = /^site-reviews(-\d+)?$/

async function siteReviewsFolder(who: Identity, event?: H3Event) {
  const now = Date.now()
  const { days } = expiryPolicy(event)
  const folders = await db
    .select()
    .from(drops)
    .where(
      and(
        eq(drops.ownerId, who.userId),
        eq(drops.kind, "folder"),
        eq(drops.teamFolder, false),
        isNull(drops.parentId),
        isNull(drops.trashedAt),
        isNull(drops.quarantinedAt),
      ),
    )
    .orderBy(desc(drops.createdAt))
  const folder = folders.find((row) => SITE_REVIEWS_SLUG.test(row.slug ?? "") && !isExpired(row, now, days))
  if (!folder)
    return createFolder(
      who,
      { title: "Site reviews", slug: "site-reviews", note: "Site reviews made without a folder land here." },
      event,
    )
  await renewDrop(folder, now)
  return folder
}

export async function createSiteDrop(
  who: Identity,
  input: LifetimeInput & {
    agent?: AgentMetadata
    url: string
    title?: string
    slug?: string
    share?: Share
    folder?: DropRow
  },
  event?: H3Event,
) {
  const siteUrl = siteAddress(input.url)
  if (!siteUrl) throw new HTTPError({ status: 400, statusText: `That address can't be reviewed. ${SITE_ADDRESS_RULE}` })
  if (event && siteCoversDrop(event, siteUrl))
    throw new HTTPError({
      status: 400,
      statusText: "That address is Drop itself or where it shows drops, which can't be a site to review.",
    })
  const folder =
    input.folder ?? (!input.lifetime || input.lifetime === "review" ? await siteReviewsFolder(who, event) : null)
  const ownerId = folder && !folder.teamFolder ? folder.ownerId : who.userId
  const life = folder ? lifetimeFields(who, {}, folder, event) : lifetimeFields(who, input, null, event)
  await requireKeepSlot(ownerId, life, false, !folder)
  const mode = modeFor(folder, event)
  const { share, publicUntil } = input.share
    ? shareFields(input.share, { kind: "site", team: mode === "team" }, event)
    : { share: defaultShare(mode), publicUntil: null }
  return withDropQuota(ownerId, { drops: 1, bytes: 0, writes: 0 }, event, async (quota) => {
    const now = Date.now()
    const host = siteHost(siteUrl)
    const title = (input.title?.trim() || host).slice(0, 160)
    const row: DropRow = {
      id: newLink(),
      ownerId,
      kind: "site",
      title,
      filename: host,
      blobKey: null,
      contentType: null,
      size: 0,
      version: 1,
      slug: await uniqueSlug(folder?.id ?? null, (input.slug && slugify(input.slug)) || slugify(title)),
      share,
      publicUntil,
      teamFolder: false,
      shareReview: isPublic(share) ? await shareReviewFor(ownerId, event) : null,
      quarantinedAt: null,
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
      parentId: folder?.id ?? null,
      siteUrl,
      publishToken: null,
      draftImage: false,
      teamId: null,
      resources: null,
    }
    await quota.commit([db.insert(drops).values(row), ...(folder ? [touchFolder(folder.id, now)] : [])])
    logDrop(event, row, { change: "create" })
    return row
  })
}

export type Screenshot = { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" | "image/webp" }

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const

function screenshotType(bytes: Uint8Array): Screenshot["contentType"] | null {
  const type = detectContentType(bytes)
  return type === "image/png" || type === "image/jpeg" || type === "image/webp" ? type : null
}

export async function readReviewComment(
  event: H3Event,
): Promise<{ input: ReviewCommentInput; shot: Screenshot | null; images: CommentImage[] }> {
  const form = await readForm(event)
  const data = form.get("data")
  let input: ReviewCommentInput
  try {
    input = v.parse(ReviewCommentSchema, JSON.parse(textValue(data) ?? ""))
  } catch (error) {
    throw new HTTPError({ status: 400, statusText: v.isValiError(error) ? error.message : "The comment is missing." })
  }

  const images = await imagesOf(form)
  const file = form.get("screenshot")
  if (file === null) return { input, shot: null, images }
  if (!(file instanceof File)) throw new HTTPError({ status: 400, statusText: "The screenshot must be a file." })
  if (file.size > MAX_FILE_BYTES)
    throw new HTTPError({ status: 413, statusText: "The screenshot exceeds the 4 MiB limit." })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const contentType = screenshotType(bytes)
  if (!contentType)
    throw new HTTPError({ status: 400, statusText: "The screenshot must be a PNG, JPEG, or WebP image." })
  return { input, shot: { bytes, contentType }, images }
}

export async function addReviewComment(
  site: DropRow,
  author: { who: Identity | null; name: string; guest: string | null },
  input: ReviewCommentInput,
  shot: Screenshot | null,
  origin: string,
  images: CommentImage[] = [],
): Promise<{ row: DropThread; attachments: CommentAttachment[] | null }> {
  if (input.requestId) {
    const existing = await submittedReview(site, input.requestId)
    if (existing) return { row: existing, attachments: null }
  }
  let created: Awaited<ReturnType<typeof insertReviewComment>> | undefined
  try {
    const { row, attachments } = await withImages(
      site,
      images,
      author.name,
      async (ids) => {
        created = await insertReviewComment(
          site,
          author,
          input,
          shot,
          origin,
          ids,
          Boolean(input.requestId && images.length),
        )
        return created
      },
      (added) => ({ commentId: added.messages[0]!.id, replyId: null }),
    )
    if (row.meta.requestPending) {
      const threads = commentsSchema.vitehubCommentThreads
      await db
        .update(threads)
        .set({ metadata: sql`json_remove(${threads.metadata}, '$.requestPending')` })
        .where(eq(threads.id, row.id))
    }
    return { row, attachments }
  } catch (error) {
    if (created) {
      const shotDrop = created.meta.dropId === site.id ? null : await findDrop(created.meta.dropId)
      await removeThread(created)
      if (shotDrop) await deleteDrop(shotDrop)
    }
    if (input.requestId) {
      const existing = await submittedReview(site, input.requestId)
      if (existing) return { row: existing, attachments: null }
    }
    throw error
  }
}

async function submittedReview(site: Pick<DropRow, "id">, requestId: string) {
  const [receipt] = await db
    .select({ threadId: reviewSubmissions.threadId })
    .from(reviewSubmissions)
    .where(and(eq(reviewSubmissions.scope, `site:${site.id}`), eq(reviewSubmissions.requestId, requestId)))
    .limit(1)
  const thread = receipt ? await findThread(receipt.threadId) : null
  if (thread?.meta.requestPending)
    throw new HTTPError({ status: 503, statusText: "The comment's images are still being stored. Try again shortly." })
  return thread
}

async function insertReviewComment(
  site: DropRow,
  author: { who: Identity | null; name: string; guest: string | null },
  input: ReviewCommentInput,
  shot: Screenshot | null,
  origin: string,
  attachments: string[],
  pending: boolean,
) {
  const now = Date.now()
  const element = {
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(pending ? { requestPending: true } : {}),
    ox: input.ox,
    oy: input.oy,
    ow: input.ow,
    oh: input.oh,
    page: reviewPage(site, origin, input.page),
    label: input.selector || null,
    quote: input.label || null,
    elementX: input.selector && input.spot ? input.spot.x : null,
    elementY: input.selector && input.spot ? input.spot.y : null,
  }
  const thread = { body: input.body, author: authorOf(author.who, author.name, author.guest), attachments }
  const path = input.page.replace(/[?#].*$/, "") || "/"
  if (!shot)
    return addThread(
      site,
      { ...thread, fields: { ...element, kind: "area", selector: input.selector || "body" } },
      siteCommentList(site),
    )
  const image = await withDropQuota(
    site.ownerId,
    { drops: 0, bytes: shot.bytes.byteLength, writes: 1 },
    undefined,
    async (quota) => {
      const key = `${crypto.randomUUID()}.${EXTENSIONS[shot.contentType]}`
      const [storageError] = await blob.put(key, shot.bytes, { contentType: shot.contentType })
      if (storageError) throw storageFailure(storageError)
      const where = site.siteUrl && isSitePattern(site.siteUrl) ? new URL(origin).host + path : path
      const row = imageDrop(
        site,
        {
          key,
          contentType: shot.contentType,
          size: shot.bytes.byteLength,
          filename: `screenshot.${EXTENSIONS[shot.contentType]}`,
          title: `Screenshot of ${where}`,
          note: `${input.viewport.width}x${input.viewport.height} viewport`,
        },
        author.name,
        now,
      )
      try {
        await quota.commit([db.insert(drops).values(row)])
      } catch (error) {
        await blob.delete([key])
        throw error
      }
      return row
    },
  )
  try {
    return await addThread(
      image,
      { ...thread, fields: { ...element, kind: "image", selector: "body > img" } },
      siteCommentList(site, true),
    )
  } catch (error) {
    await deleteDrop(image)
    throw error
  }
}

export async function siteItems(
  site: Pick<DropRow, "id" | "kind" | "parentId" | "version">,
  reader: Reader,
  origin: string,
  page?: string,
  { open = false } = {},
): Promise<SiteReviewItem[]> {
  const [{ threads, attachments }, shots] = await Promise.all([
    threadsFor(site, { open }),
    db
      .select({ id: drops.id, slug: drops.slug, blobKey: drops.blobKey })
      .from(drops)
      .where(and(eq(drops.parentId, site.id), eq(drops.kind, "image"))),
  ])
  const byId = new Map(shots.map((shot) => [shot.id, shot]))
  return threads
    .filter(({ meta }) => !meta.requestPending)
    .filter(({ meta }) => !page || meta.page === page || Boolean(meta.page?.startsWith(`${page}#`)))
    .sort((a, b) => b.createdAt - a.createdAt || b.n - a.n)
    .map((thread) => {
      const { meta } = thread
      const shot = byId.get(meta.dropId)
      return {
        ...toComment(thread, reader, attachments),
        requestId: meta.requestId,
        spot: spotOf(meta),
        screenshot: shot?.blobKey
          ? {
              id: shot.id,
              link: shot.id,
              slug: shot.slug ?? "screenshot",
              url: new URL(`/f/${shot.blobKey}`, origin).href,
            }
          : null,
      }
    })
}

const spotOf = (meta: DropThread["meta"]) =>
  meta.elementX !== null && meta.elementY !== null ? { x: meta.elementX, y: meta.elementY } : null

const reviewImages = (files: SiteReviewItem["attachments"]) => files.map(({ id, filename }) => ({ id, filename }))

type ReviewItem = Omit<SiteReviewItem, "screenshot"> & { screenshot: { id: string } | null }

export function reviewThreads(site: DropRow, who: Identity | null, items: SiteReviewItem[]): ReviewThread[] {
  const others = mayResolveSite(site, who, false)
  return items.map((item) => reviewThread(item, others, who !== null))
}

export function reviewThreadOf(
  site: DropRow,
  who: Identity | null,
  guest: string | null,
  thread: DropThread,
  attachments: CommentAttachment[],
): ReviewThread {
  const files = new Map(attachments.map((file) => [file.id, file]))
  const { meta } = thread
  return reviewThread(
    {
      ...toComment(thread, readerOf(who, guest), files),
      requestId: meta.requestId,
      spot: spotOf(meta),
      screenshot: meta.dropId === site.id ? null : { id: meta.dropId },
    },
    mayResolveSite(site, who, false),
    who !== null,
  )
}

function reviewThread(item: ReviewItem, others: boolean, signedIn: boolean): ReviewThread {
  return {
    n: item.n,
    requestId: item.requestId,
    body: item.body,
    author: { name: writtenBy(item), image: item.agent ? null : item.authorImage },
    createdAt: item.createdAt,
    resolved: item.resolved,
    mine: item.mine,
    canResolve: others || (signedIn && item.mine),
    page: item.page,
    element: item.label ? { selector: item.label, label: item.quote } : null,
    spot: item.spot,
    box: { ox: item.ox, oy: item.oy, ow: item.ow, oh: item.oh },
    screenshot: item.screenshot?.id ?? null,
    images: reviewImages(item.attachments),
    replies: item.replies.map((reply) => ({
      author: { name: writtenBy(reply), image: reply.agent ? null : reply.authorImage },
      body: reply.body,
      createdAt: reply.createdAt,
      images: reviewImages(reply.attachments),
    })),
  }
}

export async function reviewImage(site: Pick<DropRow, "id">, id: string) {
  const image = await findDrop(id)
  return image?.kind === "image" && image.parentId === site.id && image.blobKey ? image : null
}
