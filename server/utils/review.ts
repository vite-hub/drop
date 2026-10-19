import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { log } from "evlog"
import { defineHandler, type H3Event, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
import { useServerEnv } from "#vitehub/env/server"
import { newLink, slugify } from "#shared/links"
import { isSitePattern, REVIEW_TOKEN_HOURS, SITE_ADDRESS_RULE, siteAddress, siteAddressesFor, siteHost, siteMatches } from "#shared/review"
import type { ReviewCommentInput } from "#shared/schemas"
import type { SiteReviewItem } from "#shared/types"
import { defaultShare, isPublic, type Share } from "#shared/share"
import { account, comments, drops, user } from "../databases/config"
import { commentExtras, nextCommentNumber, siteFamily, toComment } from "./comments"
import { type DropRow, findDrop, type LifetimeInput, lifetimeFields, permissions } from "./drops"
import { githubOrganization, isGitHubMember } from "./github-membership"
import { type Identity, roleOf } from "./identity"
import { DropQuotaError, withDropQuota } from "./quotas"
import { shareFields, sharePolicy } from "./share"
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
export interface ReviewClaims { d: string; u: string | null; n: string; o: string; e: number }

/** What the popup sends back when someone picks a site drop: which one, for which origin and person. Sealed too. */
interface Choice { c: string; o: string; u: string | null; e: number }

const encoder = new TextEncoder()
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const unbase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0))

/** AES-GCM under the auth secret, like content-origin labels. Once ViteHub ships VITEHUB_SECRET, `deriveSecret("drop:review-token")`. */
async function sealKey(event: H3Event) {
  const secret = (useServerEnv(event) as { auth?: { secret?: { unseal: () => string } } }).auth?.secret?.unseal()
  // No fallback: a known key would let anyone mint tokens.
  if (!secret) throw new HTTPError({ status: 503, statusText: "Site review needs the auth secret (BETTER_AUTH_SECRET)." })
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`review-token:${secret}`))
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"])
}

/** What a sealed value is for. Each one is sealed under its own `purpose`, so none passes as another. */
type SealPurpose = "token" | "choice" | "upload"

/** Encrypted and authenticated: the page can neither read it nor change it. `purpose` keeps a choice from passing as a token. */
export async function seal(event: H3Event, purpose: SealPurpose, value: object) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(purpose) }, await sealKey(event), encoder.encode(JSON.stringify(value))))
  const bytes = new Uint8Array(iv.length + sealed.length)
  bytes.set(iv)
  bytes.set(sealed, iv.length)
  return `v2.${base64url(bytes)}`
}

export async function unseal<T>(event: H3Event, purpose: SealPurpose, text: string, maxLength = 2048): Promise<T | null> {
  const [version, body, extra] = text.split(".")
  if (version !== "v2" || !body || extra !== undefined || text.length > maxLength) return null
  try {
    const bytes = unbase64url(body)
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: encoder.encode(purpose) }, await sealKey(event), bytes.slice(12))
    return JSON.parse(new TextDecoder().decode(plain)) as T
  }
  catch (error) {
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
  const claims = await unseal<ReviewClaims>(event, "token", token)
  return claims && typeof claims.d === "string" && typeof claims.o === "string" && claims.e > now ? claims : null
}

/** The handle the popup lists a site drop by: good for ten minutes, for this origin and this person only. */
export const sealChoice = (event: H3Event, site: Pick<DropRow, "id">, origin: string, who: Identity | null, now = Date.now()) =>
  seal(event, "choice", { c: site.id, o: origin, u: who?.userId ?? null, e: now + 600_000 } satisfies Choice)

/** The site drop id behind a choice, when it was made for this origin and person and hasn't run out. */
export async function openChoice(event: H3Event, text: string, origin: string, who: Identity | null, now = Date.now()) {
  const choice = await unseal<Choice>(event, "choice", text)
  return choice && choice.o === origin && choice.u === (who?.userId ?? null) && choice.e > now ? choice.c : null
}

/** Site drops whose address covers `origin`, found by equality: the origin itself, or the one pattern that could cover it. */
function sitesCovering(origin: string) {
  const addresses = siteAddressesFor(origin)
  return addresses.length ? and(eq(drops.kind, "site"), inArray(drops.siteUrl, addresses), isNull(drops.trashedAt), isNull(drops.quarantinedAt)) : null
}

/**
 * The site drops whose address covers `origin` and that `who` may comment on, newest first, each with its owner's name.
 * Guests only find the ones whose link lets anyone comment; nobody finds one they couldn't comment on.
 */
export async function sitesFor(origin: string, who: Identity | null, event?: H3Event) {
  const where = sitesCovering(origin)
  if (!where) return []
  const rows = await db.select({ id: drops.id, owner: user.name }).from(drops).leftJoin(user, eq(user.id, drops.ownerId))
    .where(where).orderBy(desc(drops.updatedAt)).limit(50)
  const found = await Promise.all(rows.map(row => findDrop(row.id, event)))
  return found.flatMap((site, index) => site?.kind === "site" && site.siteUrl && siteMatches(site.siteUrl, origin) && permissions(site, who).comment
    ? [{ site, owner: rows[index]!.owner ?? "" }]
    : [])
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
  const grants = (site.grants ?? [{ share: site.share }]).filter(grant => !isPublic(grant.share))
  return permissions({ ...site, grants }, who).view
}

/**
 * The person behind a token, as they are now: a ban or a lost organization membership ends their review session
 * before the token runs out. Null for a guest.
 */
async function reviewer(claims: ReviewClaims): Promise<Identity | null | false> {
  if (!claims.u) return githubOrganization() ? false : null
  const [row] = await db.select().from(user).where(eq(user.id, claims.u)).limit(1)
  if (!row || row.banned) return false
  if (githubOrganization()) {
    const [github] = await db.select({ token: account.accessToken }).from(account).where(and(eq(account.userId, row.id), eq(account.providerId, "github"))).limit(1)
    if (!await isGitHubMember(github?.token)) return false
  }
  return { userId: row.id, name: row.name, email: row.email, image: row.image ?? null, role: roleOf(row), actorKind: "browser", actorName: row.name }
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
  }
  else if (await covered(origin)) event.res.headers.set("Access-Control-Allow-Origin", origin)
  throw new HTTPError({ status: 401, statusText: "Your review session ended. Connect again to comment." })
}

/** The preflight before a review request, which carries no token yet: allowed for origins some site drop covers. */
export async function reviewPreflight(event: H3Event) {
  const origin = event.req.headers.get("origin") ?? ""
  if (!await covered(origin)) throw new HTTPError({ status: 404, statusText: "No site review here." })
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "600",
      "Vary": "Origin",
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
export function reviewApi(handler: (event: H3Event) => Promise<unknown>) {
  return defineHandler(async (event) => {
    try { return await handler(event) }
    catch (error) {
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
export async function createSiteDrop(who: Identity, input: LifetimeInput & { url: string; title?: string; slug?: string; share?: Share; folder?: DropRow }, event?: H3Event) {
  const siteUrl = siteAddress(input.url)
  if (!siteUrl) throw new HTTPError({ status: 400, statusText: `That address can't be reviewed. ${SITE_ADDRESS_RULE}` })
  const folder = input.folder ?? null
  const ownerId = folder && !folder.teamFolder ? folder.ownerId : who.userId
  const life = folder ? lifetimeFields(who, {}, folder, event) : lifetimeFields(who, input, null, event)
  const { share, publicUntil } = input.share ? shareFields(input.share, { kind: "site" }, event) : { share: defaultShare(sharePolicy(event).mode), publicUntil: null }
  return withDropQuota(ownerId, { drops: 1, bytes: 0, writes: 0 }, event, async (quota) => {
    const now = Date.now()
    const host = siteHost(siteUrl)
    const title = (input.title?.trim() || host).slice(0, 160)
    const row: DropRow = {
      id: crypto.randomUUID(), ownerId, kind: "site", title, filename: host, blobKey: null, contentType: null, size: 0,
      version: 1, supersedesId: null, link: newLink(), slug: await uniqueSlug(folder?.id ?? null, (input.slug && slugify(input.slug)) || slugify(title)),
      share, publicUntil, teamFolder: false, shareReview: isPublic(share) ? await shareReviewFor(ownerId, event) : null, quarantinedAt: null,
      actorKind: who.actorKind, actorName: who.actorName, createdAt: now, updatedAt: now, lastAccessedAt: now,
      ...life, note: input.note?.trim() || null, trashedAt: null, trashReason: null, parentId: folder?.id ?? null, siteUrl, publishToken: null,
    }
    await quota.commit([db.insert(drops).values(row), ...(folder ? [touchFolder(folder.id, now)] : [])])
    return row
  })
}

export type Screenshot = { bytes: Uint8Array; contentType: "image/png" | "image/jpeg" | "image/webp" }

/** The image's real type from its first bytes, whatever the page claimed. Only the three a browser canvas makes. */
export function screenshotType(bytes: Uint8Array): Screenshot["contentType"] | null {
  const at = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value)
  if (at(0, 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)) return "image/png"
  if (at(0, 0xFF, 0xD8, 0xFF)) return "image/jpeg"
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp"
  return null
}

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const

/**
 * Stores what someone sent from the site. With a screenshot, the screenshot becomes a private image of the site (like
 * a doc's attachment, it shares the site's sharing, lifetime, and Trash) and the comment marks the box on it, so
 * Drop's image view draws it and takes replies. Without one, the comment goes on the site itself.
 *
 * The page's element is kept the same way in both: `label` holds its selector and `quote` its tag and text, which
 * the comment lists show. The comment's own `selector` is its anchor in Drop: the screenshot (`body > img` in the
 * image view), or the element itself on the site. `origin` is the page's, from its token.
 */
export async function addReviewComment(site: DropRow, author: { who: Identity | null; name: string }, input: ReviewCommentInput, shot: Screenshot | null, origin: string) {
  const now = Date.now()
  const fields = {
    id: crypto.randomUUID(), body: input.body, page: reviewPage(site, origin, input.page), ox: input.ox, oy: input.oy, ow: input.ow, oh: input.oh,
    label: input.selector || null, quote: input.label || null,
    authorId: author.who?.userId ?? null, authorName: author.name, resolved: false, createdAt: now,
  }
  if (!shot) {
    const [row] = await db.insert(comments).values({ ...fields, dropId: site.id, n: nextCommentNumber(site), kind: "area", selector: input.selector || "body" }).returning()
    return row!
  }
  // The site's owner pays for the bytes, as for anything else in their drops. No publish burst: the route's own rate
  // limit is per reviewer, and reviewers shouldn't use up the owner's agents' publishes.
  return withDropQuota(site.ownerId, { drops: 0, bytes: shot.bytes.byteLength, writes: 1 }, undefined, async (quota) => {
    const id = crypto.randomUUID()
    const key = `${crypto.randomUUID()}.${EXTENSIONS[shot.contentType]}`
    const [storageError] = await blob.put(key, shot.bytes, { access: "private", contentType: shot.contentType })
    if (storageError) {
      log.error({ action: "review-screenshot", error: storageError.message })
      throw new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable." })
    }
    const path = input.page.replace(/[?#].*$/, "") || "/"
    const where = site.siteUrl && isSitePattern(site.siteUrl) ? new URL(origin).host + path : path
    const image: DropRow = {
      id, ownerId: site.ownerId, kind: "image", title: `Screenshot of ${where}`.slice(0, 160), filename: `screenshot.${EXTENSIONS[shot.contentType]}`,
      blobKey: key, contentType: shot.contentType, size: shot.bytes.byteLength, version: 1, supersedesId: null, link: newLink(), slug: "screenshot",
      share: "private", publicUntil: null, teamFolder: false, shareReview: null, quarantinedAt: null, actorKind: "browser", actorName: author.name,
      createdAt: now, updatedAt: now, lastAccessedAt: now, lifetime: "review", keepReason: null,
      note: `${input.viewport.width}x${input.viewport.height} viewport`, trashedAt: null, trashReason: null, parentId: site.id, siteUrl: null, publishToken: null,
    }
    try {
      await quota.commit([
        db.insert(drops).values(image),
        db.insert(comments).values({ ...fields, dropId: id, n: nextCommentNumber(image), kind: "image", selector: "body > img" }),
      ])
    }
    catch (error) {
      await blob.del([key])
      throw error
    }
    const [row] = await db.select().from(comments).where(eq(comments.id, fields.id)).limit(1)
    return row!
  })
}

/** The site's review list, newest first, each comment with the screenshot it came with. `page` is as `reviewPage` keeps it. */
export async function siteItems(site: Pick<DropRow, "id">, who: Identity | null, origin: string, page?: string): Promise<SiteReviewItem[]> {
  const rows = await db.select({ comment: comments, shot: { id: drops.id, kind: drops.kind, link: drops.link, slug: drops.slug, blobKey: drops.blobKey } })
    .from(comments).innerJoin(drops, eq(drops.id, comments.dropId))
    .where(and(sql`${comments.dropId} IN (${siteFamily(site.id)})`, page ? sql`(${comments.page} = ${page} OR ${comments.page} LIKE ${`${page.replace(/[\\%_]/g, "\\$&")}#%`} ESCAPE '\\')` : undefined))
    .orderBy(asc(comments.createdAt)).limit(500)
  const extras = await commentExtras(rows.map(item => item.comment), siteFamily(site.id))
  return rows.reverse().map(({ comment, shot }) => ({
    ...toComment(comment, who, 1, extras),
    screenshot: shot.kind === "image" && shot.blobKey ? { id: shot.id, link: shot.link ?? shot.id, slug: shot.slug ?? "screenshot", url: new URL(`/f/${shot.blobKey}`, origin).href } : null,
  }))
}
