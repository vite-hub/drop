import { and, asc, eq, sql } from "drizzle-orm"
import { log } from "evlog"
import { defineHandler, type H3Event, HTTPError } from "h3"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
import { useServerEnv } from "#vitehub/env/server"
import { newLink, slugify } from "#shared/links"
import { isRole, type Role } from "#shared/roles"
import { REVIEW_TOKEN_HOURS, siteOrigin } from "#shared/review"
import type { ReviewCommentInput } from "#shared/schemas"
import type { Access, SiteReviewItem, Visibility } from "#shared/types"
import { account, comments, drops, user } from "../databases/config"
import { nextCommentNumber, siteFamily, toComment } from "./comments"
import { type DropRow, findDrop, type LifetimeInput, lifetimeFields, permissions } from "./drops"
import { githubOrganization, isGitHubMember } from "./github-membership"
import type { Identity } from "./identity"
import { DropQuotaError, withDropQuota } from "./quotas"
import { routeId } from "./params"
import { shareReviewFor } from "./trust"

/**
 * Site review. A site drop names a website by its origin (`siteUrl`); its pages load /review.js, which sends comments
 * and screenshots to /api/review/:id/comments. Drop never frames the site, so its cookies and its login keep
 * working, and the script never sends Drop's cookies, which would be third-party there. It carries a review token
 * instead, which the connect popup (/review/connect) issues to people who may comment and hands only to `siteUrl`.
 */

/** What a review token says: the site drop, who sends (null for a guest on a "Can comment" link), and where from. */
export interface ReviewClaims { d: string; u: string | null; n: string; o: string; e: number }

const encoder = new TextEncoder()
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const unbase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0))

/** HMAC under the auth secret, like content-origin labels. Once ViteHub ships VITEHUB_SECRET, `deriveSecret("drop:review-token")`. */
async function tokenKey(event: H3Event) {
  const secret = (useServerEnv(event) as { auth?: { secret?: { unseal: () => string } } }).auth?.secret?.unseal()
  // No fallback: a known key would let anyone mint tokens.
  if (!secret) throw new HTTPError({ status: 503, statusText: "Site review needs the auth secret (BETTER_AUTH_SECRET)." })
  return crypto.subtle.importKey("raw", encoder.encode(`review-token:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])
}

export async function signReviewToken(event: H3Event, claims: Omit<ReviewClaims, "e">, now = Date.now()) {
  const full: ReviewClaims = { ...claims, e: now + REVIEW_TOKEN_HOURS * 3_600_000 }
  const payload = base64url(encoder.encode(JSON.stringify(full)))
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await tokenKey(event), encoder.encode(payload)))
  return { token: `v1.${payload}.${base64url(signature)}`, expiresAt: full.e }
}

/** The token's claims when it's ours, unexpired, and for this site drop and origin. Null otherwise. */
export async function readReviewToken(event: H3Event, token: string, site: Pick<DropRow, "id" | "siteUrl">, now = Date.now()): Promise<ReviewClaims | null> {
  const [version, payload, signature] = token.split(".")
  if (version !== "v1" || !payload || !signature || token.length > 2048) return null
  let claims: ReviewClaims
  try {
    if (!await crypto.subtle.verify("HMAC", await tokenKey(event), unbase64url(signature), encoder.encode(payload))) return null
    claims = JSON.parse(new TextDecoder().decode(unbase64url(payload)))
  }
  catch (error) {
    if (HTTPError.isError(error)) throw error
    return null
  }
  if (claims.d !== site.id || !site.siteUrl || claims.o !== site.siteUrl || !(claims.e > now)) return null
  return claims
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
  const role = row.role ?? "member"
  return { userId: row.id, name: row.name, email: row.email, image: row.image ?? null, role: isRole(role) ? role as Role : "member", actorKind: "browser", actorName: row.name }
}

/**
 * The site drop a review request names, answering CORS for its site only. Any other origin gets no CORS headers,
 * so its page can't read the answer; nothing here reflects whatever origin asked.
 */
export async function reviewSite(event: H3Event) {
  const site = await findDrop(await routeId(event), event)
  const origin = event.req.headers.get("origin")
  if (!site || site.kind !== "site" || !site.siteUrl || origin !== site.siteUrl) throw new HTTPError({ status: 404, statusText: "No site review here." })
  event.res.headers.set("Access-Control-Allow-Origin", site.siteUrl)
  event.res.headers.set("Vary", "Origin")
  event.res.headers.set("Cache-Control", "no-store")
  return site
}

/** Who sends this review request, from its bearer token. They must still be allowed to comment on the site. */
export async function requireReviewer(event: H3Event, site: DropRow) {
  const token = event.req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1]
  const claims = token ? await readReviewToken(event, token, site) : null
  const who = claims ? await reviewer(claims) : false
  if (!claims || who === false || !permissions(site, who).comment)
    throw new HTTPError({ status: 401, statusText: "Your review session ended. Connect again to comment." })
  return { claims, who }
}

/**
 * Review routes answer the site's page in every case, errors included, so the script can tell an ended session from
 * a full plan. CORS headers set by `reviewSite` would otherwise be lost to Nitro's error page.
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

/** A new site drop: no file, just the origin people review. */
export async function createSiteDrop(who: Identity, input: LifetimeInput & { url: string; title?: string; slug?: string; visibility?: Visibility; access?: Access }, event?: H3Event) {
  const siteUrl = siteOrigin(input.url)
  if (!siteUrl) throw new HTTPError({ status: 400, statusText: "The site's address must be https, or http on localhost." })
  const life = lifetimeFields(who, input, null, event)
  return withDropQuota(who.userId, { drops: 1, bytes: 0, writes: 0 }, event, async (quota) => {
    const now = Date.now()
    const host = new URL(siteUrl).host
    const title = (input.title?.trim() || host).slice(0, 160)
    const visibility = input.visibility ?? "private"
    const row: DropRow = {
      id: crypto.randomUUID(), ownerId: who.userId, kind: "site", title, filename: host, blobKey: null, contentType: null, size: 0,
      version: 1, supersedesId: null, link: newLink(), slug: (input.slug && slugify(input.slug)) || slugify(title),
      visibility, access: input.access ?? "comment", shareReview: visibility !== "private" ? await shareReviewFor(who.userId, event) : null, quarantinedAt: null,
      actorKind: who.actorKind, actorName: who.actorName, createdAt: now, updatedAt: now, lastAccessedAt: now,
      ...life, note: input.note?.trim() || null, trashedAt: null, trashReason: null, parentId: null, siteUrl, publishToken: null,
    }
    await quota.commit([db.insert(drops).values(row)])
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
 * image view), or the element itself on the site.
 */
export async function addReviewComment(site: DropRow, author: { who: Identity | null; name: string }, input: ReviewCommentInput, shot: Screenshot | null) {
  const now = Date.now()
  const fields = {
    id: crypto.randomUUID(), body: input.body, page: input.page, ox: input.ox, oy: input.oy, ow: input.ow, oh: input.oh,
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
    const image: DropRow = {
      id, ownerId: site.ownerId, kind: "image", title: `Screenshot of ${path}`.slice(0, 160), filename: `screenshot.${EXTENSIONS[shot.contentType]}`,
      blobKey: key, contentType: shot.contentType, size: shot.bytes.byteLength, version: 1, supersedesId: null, link: newLink(), slug: "screenshot",
      visibility: "private", access: "comment", shareReview: null, quarantinedAt: null, actorKind: "browser", actorName: author.name,
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

/** The site's review list, newest first, each comment with the screenshot it came with. */
export async function siteItems(site: Pick<DropRow, "id">, who: Identity | null, origin: string, page?: string): Promise<SiteReviewItem[]> {
  const rows = await db.select({ comment: comments, shot: { id: drops.id, kind: drops.kind, link: drops.link, slug: drops.slug, blobKey: drops.blobKey } })
    .from(comments).innerJoin(drops, eq(drops.id, comments.dropId))
    .where(and(sql`${comments.dropId} IN (${siteFamily(site.id)})`, page ? sql`(${comments.page} = ${page} OR ${comments.page} LIKE ${`${page.replace(/[\\%_]/g, "\\$&")}#%`} ESCAPE '\\')` : undefined))
    .orderBy(asc(comments.createdAt)).limit(500)
  return rows.reverse().map(({ comment, shot }) => ({
    ...toComment(comment, who, 1),
    screenshot: shot.kind === "image" && shot.blobKey ? { id: shot.id, link: shot.link ?? shot.id, slug: shot.slug ?? "screenshot", url: new URL(`/f/${shot.blobKey}`, origin).href } : null,
  }))
}
