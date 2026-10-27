import type { AgentMetadata } from "#shared/agent"
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { defineHandler, type H3Event, HTTPError } from "h3"
import * as v from "valibot"
import { textValue } from "#shared/utils/text"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { db } from "vite-hub/database/drizzle"
import { useServerEnv } from "#vitehub/env/server"
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
import type { ReviewThread, SiteReviewItem } from "#shared/types"
import { defaultShare, isPublic, type Share } from "#shared/share"
import { comments, drops, user } from "../databases/config"
import { attachImages, type CommentImage, imageDrop, imagesOf, readForm, withImages } from "./comment-images"
import { commentExtras, nextCommentNumber, siteFamily, toComment } from "./comments"
import { siteCoversDrop } from "./content-origin"
import {
  deleteDrop,
  type DropRow,
  findDrop,
  type LifetimeInput,
  lifetimeFields,
  permissions,
  storageFailure,
} from "./drops"
import { type Identity, roleOf } from "./identity"
import { isMember, membersOnly } from "./members"
import { DropQuotaError, requireKeepSlot, withDropQuota } from "./quotas"
import { modeFor, shareFields } from "./share"
import { shareReviewFor } from "./trust"
import { touchFolder, uniqueSlug } from "./nodes"

/**
 * Site review. A site drop names a website by its origin, or by a pattern that covers every preview deploy (`siteUrl`,
 * see shared/review.ts); its pages load /review.js, which sends comments and screenshots to /api/review/comments.
 * Drop never frames the site, so its cookies and its login keep working, and the script never sends Drop's cookies,
 * which would be third-party there. It carries a review token instead, which the connect popup (/review/connect)
 * issues to people who may comment and hands only to the page's own origin.
 *
 * Nothing in the page names the site drop: the script has no key, and the token is sealed, so the page can't read
 * which drop it is for. Drop finds the site drops for a page by its origin when someone connects, and lists only the
 * ones that person may comment on. Neither the drop's link nor its id reaches the page, so nothing there opens the review.
 */

/** What a review token says: the site drop, who sends (null for a guest on a "Can comment" link), and the page's origin. */
const ReviewClaims = v.object({ d: v.string(), u: v.nullable(v.string()), n: v.string(), o: v.string(), e: v.number() })
export type ReviewClaims = v.InferOutput<typeof ReviewClaims>

/** What the popup sends back when someone picks a site drop: which one, for which origin and person. Sealed too. */
const Choice = v.object({ c: v.string(), o: v.string(), u: v.nullable(v.string()), e: v.number() })
type Choice = v.InferOutput<typeof Choice>

const encoder = new TextEncoder()
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
const unbase64url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0))

/** AES-GCM under the auth secret, like content-origin labels. Once ViteHub ships VITEHUB_SECRET, `deriveSecret("drop:review-token")`. */
async function sealKey(event: H3Event) {
  // Optional: an environment without the auth secret (the tests' one) gets the 503 below, not a TypeError.
  const secret = useServerEnv(event).auth?.secret?.unseal()
  // No fallback: a known key would let anyone mint tokens.
  if (!secret)
    throw new HTTPError({ status: 503, statusText: "Site review needs the auth secret (BETTER_AUTH_SECRET)." })
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`review-token:${secret}`))
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"])
}

/** What a sealed value is for. Each one is sealed under its own `purpose`, so none passes as another. */
type SealPurpose = "token" | "choice" | "upload" | "app-files"

/** Encrypted and authenticated: the page can neither read it nor change it. `purpose` keeps a choice from passing as a token. */
export async function seal(event: H3Event, purpose: SealPurpose, value: Readonly<Record<string, unknown>>) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(purpose) },
      await sealKey(event),
      encoder.encode(JSON.stringify(value)),
    ),
  )
  const bytes = new Uint8Array(iv.length + sealed.length)
  bytes.set(iv)
  bytes.set(sealed, iv.length)
  return `v2.${base64url(bytes)}`
}

/** The sealed value, when it was sealed for `purpose` and parses as `schema`. Null for anything else. */
export async function unseal<T extends v.GenericSchema>(
  event: H3Event,
  purpose: SealPurpose,
  schema: T,
  text: string,
  maxLength = 2048,
): Promise<v.InferOutput<T> | null> {
  const [version, body, extra] = text.split(".")
  if (version !== "v2" || !body || extra !== undefined || text.length > maxLength) return null
  try {
    const bytes = unbase64url(body)
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: encoder.encode(purpose) },
      await sealKey(event),
      bytes.slice(12),
    )
    const parsed = v.safeParse(schema, JSON.parse(new TextDecoder().decode(plain)))
    return parsed.success ? parsed.output : null
  } catch (error) {
    if (HTTPError.isError(error)) throw error
    return null
  }
}

export async function signReviewToken(event: H3Event, claims: Omit<ReviewClaims, "e">, now = Date.now()) {
  const full: ReviewClaims = { ...claims, e: now + REVIEW_TOKEN_HOURS * 3_600_000 }
  return { token: await seal(event, "token", full), expiresAt: full.e }
}

/** The token's claims when it's ours and unexpired, null otherwise. Whether its site still covers its origin is for `reviewSession`. */
export async function readReviewToken(event: H3Event, token: string, now = Date.now()): Promise<ReviewClaims | null> {
  const claims = await unseal(event, "token", ReviewClaims, token)
  return claims && claims.e > now ? claims : null
}

/** The handle the popup lists a site drop by: good for ten minutes, for this origin and this person only. */
export const sealChoice = (
  event: H3Event,
  site: Pick<DropRow, "id">,
  origin: string,
  who: Identity | null,
  now = Date.now(),
) => seal(event, "choice", { c: site.id, o: origin, u: who?.userId ?? null, e: now + 600_000 } satisfies Choice)

/** The site drop id behind a choice, when it was made for this origin and person and hasn't run out. */
export async function openChoice(event: H3Event, text: string, origin: string, who: Identity | null, now = Date.now()) {
  const choice = await unseal(event, "choice", Choice, text)
  return choice && choice.o === origin && choice.u === (who?.userId ?? null) && choice.e > now ? choice.c : null
}

/** Site drops whose address covers `origin`, found by equality: the origin itself, or the one pattern that could cover it. */
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

/**
 * The site drops whose address covers `origin` and that `who` may comment on, newest first, each with its owner's name.
 * Guests only find the ones whose link lets anyone comment; nobody finds one they couldn't comment on.
 */
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

/** Whether any site drop covers `origin`. That much is all a page learns before it has a token. */
async function covered(origin: string) {
  const where = sitesCovering(origin)
  return Boolean(where && (await db.select({ id: drops.id }).from(drops).where(where).limit(1)).length)
}

/**
 * Whether `who` could open the site without its link: its owner, an admin, or someone a team share reaches. A public
 * link doesn't count, since finding a site by its origin is not having its link.
 */
export function openable(site: DropRow, who: Identity | null) {
  const grants = (site.grants ?? [{ share: site.share }]).filter((grant) => !isPublic(grant.share))
  return permissions({ ...site, grants }, who).view
}

/**
 * The person behind a token, as they are now: a ban or a lost membership ends their review session
 * before the token runs out. Null for a guest.
 */
async function reviewer(claims: ReviewClaims): Promise<Identity | null | false> {
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

/**
 * The site drop and the person behind a review request, from its bearer token. The token must have been issued for the
 * request's own origin, its site must still cover that origin, and the person must still be allowed to comment.
 *
 * CORS answers the request's origin when the token's site covers it. A request whose token doesn't hold up still gets
 * CORS when some site drop covers its origin, so the script can read the 401 and connect again. Any other origin gets
 * no CORS headers, so its page can't read the answer.
 */
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
    if (who !== false && permissions(site, who).comment) return { site, claims, who }
  } else if (await covered(origin)) event.res.headers.set("Access-Control-Allow-Origin", origin)
  throw new HTTPError({ status: 401, statusText: "Your review session ended. Connect again to comment." })
}

/** The preflight before a review request, which carries no token yet: allowed for origins some site drop covers. */
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

/**
 * Where a comment on the site was made. A pattern covers many origins, so its comments keep the page's origin; a site
 * with one origin keeps the path alone.
 */
export const reviewPage = (site: Pick<DropRow, "siteUrl">, origin: string, page: string) =>
  site.siteUrl && isSitePattern(site.siteUrl) ? `${origin}${page}` : page

/**
 * Review routes answer the site's page in every case, errors included, so the script can tell an ended session from
 * a full plan. CORS headers set by `reviewSession` would otherwise be lost to Nitro's error page.
 */
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

/** A new site drop: no file, just the address people review. In a folder it lives with the folder, like any drop. */
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
  const folder = input.folder ?? null
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
      teamId: null,
      resources: null,
    }
    await quota.commit([db.insert(drops).values(row), ...(folder ? [touchFolder(folder.id, now)] : [])])
    return row
  })
}

export type Screenshot = { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" | "image/webp" }

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const

/** The image's real type from its first bytes, whatever the page claimed. Only the three a browser canvas makes. */
function screenshotType(bytes: Uint8Array): Screenshot["contentType"] | null {
  const type = detectContentType(bytes)
  return type === "image/png" || type === "image/jpeg" || type === "image/webp" ? type : null
}

/**
 * A review comment as multipart: `data` (JSON, ReviewCommentSchema), an optional `screenshot`, and the `image`s the
 * reviewer added. Both the review script on the site and Drop's own embedded review send it. Every file is checked by
 * its bytes, not its claimed type, and at most 4 MiB.
 */
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

/**
 * Stores what someone sent from the site. With a screenshot, the screenshot becomes a private image of the site (like
 * a doc's attachment, it shares the site's sharing, lifetime, and Trash) and the comment marks the box on it, so
 * Drop's image view draws it and takes replies. Without one, the comment goes on the site itself.
 *
 * The page's element is kept the same way in both: `label` holds its selector and `quote` its tag and text, which
 * the comment lists show. The comment's own `selector` is its anchor in Drop: the screenshot (`body > img` in the
 * image view), or the element itself on the site. `origin` is the page's, from its token. `spot` is where on the
 * element the pin goes, so the script can put it back on the live page. `images` are what the reviewer added, stored
 * under the site like its screenshots.
 */
export async function addReviewComment(
  site: DropRow,
  author: { who: Identity | null; name: string },
  input: ReviewCommentInput,
  shot: Screenshot | null,
  origin: string,
  images: CommentImage[] = [],
) {
  const { row } = await withImages(
    images,
    () => insertReviewComment(site, author, input, shot, origin),
    (added) => attachImages(site, images, { commentId: added.id, replyId: null, n: added.n }, author.name),
    async (added) => {
      // With a screenshot, the comment is on the screenshot's drop: deleting that takes the comment with it.
      const shotDrop = added.dropId === site.id ? null : await findDrop(added.dropId)
      if (shotDrop) await deleteDrop(shotDrop)
      else await db.delete(comments).where(eq(comments.id, added.id))
    },
  )
  return row
}

async function insertReviewComment(
  site: DropRow,
  author: { who: Identity | null; name: string },
  input: ReviewCommentInput,
  shot: Screenshot | null,
  origin: string,
) {
  const now = Date.now()
  const fields = {
    id: crypto.randomUUID(),
    body: input.body,
    page: reviewPage(site, origin, input.page),
    ox: input.ox,
    oy: input.oy,
    ow: input.ow,
    oh: input.oh,
    label: input.selector || null,
    quote: input.label || null,
    elementX: input.selector && input.spot ? input.spot.x : null,
    elementY: input.selector && input.spot ? input.spot.y : null,
    authorId: author.who?.userId ?? null,
    authorName: author.name,
    resolved: false,
    createdAt: now,
  }
  if (!shot) {
    const [row] = await db
      .insert(comments)
      .values({
        ...fields,
        dropId: site.id,
        version: 1,
        n: nextCommentNumber(site),
        kind: "area",
        selector: input.selector || "body",
      })
      .returning()
    return row!
  }
  // The site's owner pays for the bytes, as for anything else in their drops. No publish burst: the route's own rate
  // limit is per reviewer, and reviewers shouldn't use up the owner's agents' publishes.
  return withDropQuota(
    site.ownerId,
    { drops: 0, bytes: shot.bytes.byteLength, writes: 1 },
    undefined,
    async (quota) => {
      const key = `${crypto.randomUUID()}.${EXTENSIONS[shot.contentType]}`
      const [storageError] = await blob.put(key, shot.bytes, { access: "private", contentType: shot.contentType })
      if (storageError) throw storageFailure(storageError)
      const path = input.page.replace(/[?#].*$/, "") || "/"
      const where = site.siteUrl && isSitePattern(site.siteUrl) ? new URL(origin).host + path : path
      const image = imageDrop(
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
        await quota.commit([
          db.insert(drops).values(image),
          db.insert(comments).values({
            ...fields,
            dropId: image.id,
            version: 1,
            n: nextCommentNumber(image),
            kind: "image",
            selector: "body > img",
          }),
        ])
      } catch (error) {
        await blob.del([key])
        throw error
      }
      const [row] = await db.select().from(comments).where(eq(comments.id, fields.id)).limit(1)
      return row!
    },
  )
}

/** The site's review list, newest first, each comment with the screenshot it came with. `page` is as `reviewPage` keeps it. */
export async function siteItems(
  site: Pick<DropRow, "id">,
  who: Identity | null,
  origin: string,
  page?: string,
): Promise<SiteReviewItem[]> {
  const [rows, extras] = await Promise.all([
    db
      .select({
        comment: comments,
        shot: { id: drops.id, kind: drops.kind, slug: drops.slug, blobKey: drops.blobKey },
      })
      .from(comments)
      .innerJoin(drops, eq(drops.id, comments.dropId))
      .where(
        and(
          sql`${comments.dropId} IN (${siteFamily(site.id)})`,
          page
            ? sql`(${comments.page} = ${page} OR ${comments.page} LIKE ${`${page.replace(/[\\%_]/g, "\\$&")}#%`} ESCAPE '\\')`
            : undefined,
        ),
      )
      .orderBy(asc(comments.createdAt))
      .limit(500),
    commentExtras(siteFamily(site.id)),
  ])
  return rows.reverse().map(({ comment, shot }) => ({
    ...toComment(comment, who, extras),
    spot: comment.elementX !== null && comment.elementY !== null ? { x: comment.elementX, y: comment.elementY } : null,
    screenshot:
      shot.kind === "image" && shot.blobKey
        ? {
            id: shot.id,
            link: shot.id,
            slug: shot.slug ?? "screenshot",
            url: new URL(`/f/${shot.blobKey}`, origin).href,
          }
        : null,
  }))
}

const reviewImages = (files: SiteReviewItem["attachments"]) => files.map(({ id, filename }) => ({ id, filename }))

/**
 * A site's threads as the review script shows them on the page (ReviewThread): no ids or links that would open the
 * review in Drop, and images by the ids /api/review/images serves with the token.
 */
export function reviewThreads(site: DropRow, who: Identity | null, items: SiteReviewItem[]): ReviewThread[] {
  const manage = permissions(site, who).manage
  return items.map((item) => ({
    n: item.n,
    body: item.body,
    author: { name: item.authorName, image: item.authorImage },
    createdAt: item.createdAt,
    resolved: item.resolved,
    mine: item.mine,
    canResolve: manage || item.mine,
    page: item.page,
    element: item.label ? { selector: item.label, label: item.quote } : null,
    spot: item.spot,
    box: { ox: item.ox, oy: item.oy, ow: item.ow, oh: item.oh },
    screenshot: item.screenshot?.id ?? null,
    images: reviewImages(item.attachments),
    replies: item.replies.map((reply) => ({
      author: { name: reply.authorName, image: reply.authorImage },
      body: reply.body,
      createdAt: reply.createdAt,
      images: reviewImages(reply.attachments),
    })),
  }))
}

/**
 * An image the review script may show: a screenshot sent from the site or an image in one of its threads. Both are
 * the site's own children; anything else is no image of this review's.
 */
export async function reviewImage(site: Pick<DropRow, "id">, id: string) {
  const image = await findDrop(id)
  return image?.kind === "image" && image.parentId === site.id && image.blobKey ? image : null
}
