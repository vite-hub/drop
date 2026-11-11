import { eq } from "drizzle-orm"
import { useLogger } from "evlog/nitro/v3"
import { getCookie, type H3Event } from "h3"
import * as v from "valibot"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
import { contentTypeOf, isTextFile } from "#shared/project-bundle"
import { dropFiles } from "../databases/config"
import { onOwnOrigin } from "./content-origin"
import { findDrop, permissions } from "./drops"
import { identityOf, type Identity } from "./identity"
import { seal, unseal } from "./review"

/**
 * An app's files, served from its own content origin like any static host, so a built app's module chunks, fonts,
 * wasm and fetch() calls load as they were built to. The origin has no session: the viewer, which checked the person
 * may open the drop, hands the frame a grant (FRAME_HOST_HTML keeps it as a cookie). A grant names the drop's link
 * (or its id, before links), and only that link's own origin takes it, so one app can't use another's grant to read its files.
 * It names who opened the app too, or nobody for a visitor signed out, and every file checks that they may still view
 * it: someone taken off the team, or a drop made private, loses its files within a few seconds.
 */

const GRANT_MS = 12 * 3_600_000
const Grant = v.object({ l: v.string(), u: v.nullable(v.string()), e: v.number() })

/** A grant to the files of the app behind `link`, for `who`, as long as they may view it. */
export const appFilesGrant = (event: H3Event, link: string, who: Identity | null, now = Date.now()) =>
  seal(event, "app-files", { l: link, u: who?.userId ?? null, e: now + GRANT_MS } satisfies v.InferOutput<typeof Grant>)

/**
 * Where each of an app's files is, for its content origin and the person the grant names. A page load asks for dozens of
 * files at once, so each isolate keeps the answer for a few seconds and shares one lookup between them, instead of a few
 * queries per file that queue up on the database. A drop moved to the Trash, made private, or republished, and someone
 * leaving its team, show within that window; a path the kept answer
 * lacks, or a file the store no longer has, looks again at once (serveAppFile).
 */
const KEEP_MS = 5_000
// Workers stop a request's I/O when its client goes away, so a lookup another request started may never settle; a
// request that waits this long on one looks up for itself.
const SHARED_WAIT_MS = 1_000
type AppFiles = Map<string, string> | null
const kept = new Map<string, { at: number; files: Promise<AppFiles> }>()

/** The app's files, and whether they were kept from an earlier request rather than looked up for this one. */
async function appFiles(event: H3Event, grant: v.InferOutput<typeof Grant>, now: number, fresh: boolean) {
  const key = `${grant.l}\n${grant.u ?? ""}`
  const entry = kept.get(key)
  if (entry && !fresh && now - entry.at < KEEP_MS) {
    const settled = entry.files.then(
      (files) => ({ files }),
      () => undefined,
    )
    const shared = await Promise.race([
      settled,
      new Promise<undefined>((resolve) => {
        const timer = setTimeout(resolve, SHARED_WAIT_MS)
        void settled.then(() => clearTimeout(timer))
      }),
    ])
    if (shared) return { files: shared.files, wasKept: true }
  }
  const files = lookUpAppFiles(event, grant)
  for (const [other, old] of kept) if (now - old.at >= KEEP_MS) kept.delete(other)
  kept.set(key, { at: now, files })
  // A failed lookup isn't kept: the next file asks again.
  files.catch(() => kept.get(key)?.files === files && kept.delete(key))
  return { files: await files, wasKept: false }
}

async function lookUpAppFiles(event: H3Event, grant: v.InferOutput<typeof Grant>): Promise<AppFiles> {
  const [drop, who] = await Promise.all([findDrop(grant.l, event), grant.u ? identityOf(grant.u) : null])
  if (!drop || drop.kind !== "app" || drop.trashedAt !== null || drop.expired || !permissions(drop, who).view)
    return null
  const rows = await db
    .select({ path: dropFiles.path, blobKey: dropFiles.blobKey })
    .from(dropFiles)
    .where(eq(dropFiles.dropId, drop.id))
  return new Map(rows.map((row) => [row.path, row.blobKey]))
}

/**
 * Build tools name what they emit after its content (`entry.2pJuYtgD.css`, `index-BdJJ9uks.js`, `B0nDsZtt.js`), so a
 * file with such a name never changes, and the browser keeps it. Any other file may change with the next version,
 * which the app's origin serves at the same address, so the browser asks again each time.
 *
 * Rollup and Vite hash with 8 base64url characters, which may hold no digit (`CWeqyEg_`) or a dash (`lXm2UH6-`). Out
 * of context such a name could be a word someone typed (`BkRpwUQU.js`), so it counts only inside a folder that build
 * tools keep for their output, and never when it reads as words (`MyWidget`): a hash shaped like one is only a cache
 * miss, a typed name kept for a year would hide the next version.
 */
export function isHashedAsset(path: string): boolean {
  const slash = path.lastIndexOf("/")
  const parts = path
    .slice(slash + 1)
    .split(".")
    .slice(0, -1)
  return (
    parts
      .flatMap((part) => part.split("-"))
      .some(
        (token) =>
          token.length >= 8 &&
          /^\w+$/.test(token) &&
          /\d/.test(token) &&
          (/^[\da-f]+$/.test(token) ? /[a-f]/.test(token) : /[a-z]/.test(token) && /[A-Z]/.test(token)),
      ) ||
    (BUILD_FOLDER.test(path.slice(0, slash + 1)) &&
      parts.some((part) => {
        const hash = /(?:^|[-.])([\w-]{8})$/.exec(part)?.[1]
        return !!hash && /[a-z]/.test(hash) && /[A-Z]/.test(hash) && !/^(?:[A-Z][a-z]+)+$/.test(hash)
      }))
  )
}

/** Folders where build tools put the files they name after their content: Nuxt, Vite, Astro, SvelteKit, Next. */
const BUILD_FOLDER = /(?:^|\/)(?:_nuxt|assets|_astro|immutable|_next\/static)\/(?:.*\/)?$/

/**
 * An app's files kept in the cache of the Cloudflare location the Worker runs in, by blob key. Each upload stores its
 * files under keys of their own and never writes to one again, so a kept file is never stale; a file the store holds
 * far from the Worker costs a few hundred milliseconds to read, and a page waits on dozens in a row. A file goes in
 * after a grant check and comes out only after another. Runtimes without a Cache API, such as
 * Node, read the store each time.
 */
const KEEP_MAX_BYTES = 25 * 1024 * 1024

function fileCache() {
  return "caches" in globalThis ? caches.open("drop-app-files") : undefined
}

function cacheKey(event: H3Event, blobKey: string, headers?: HeadersInit) {
  return new Request(`${event.url.origin}/_drop-app-files/${encodeURIComponent(blobKey)}`, { headers })
}

/** The kept answer to this request, with its range and validators: the cache answers those itself. */
async function keptFile(event: H3Event, blobKey: string): Promise<Response | undefined> {
  if (event.req.method !== "GET") return
  const cache = await fileCache()
  if (!cache) return
  const headers = new Headers()
  for (const name of ["range", "if-none-match", "if-modified-since"]) {
    const value = event.req.headers.get(name)
    if (value) headers.set(name, value)
  }
  return cache.match(cacheKey(event, blobKey, headers)).catch(() => undefined)
}

/** The body for this response, keeping a copy of a whole file once it has been read. */
function keepFile(event: H3Event, blobKey: string, status: number, body: ReadableStream | null | undefined) {
  const size = Number(event.res.headers.get("Content-Length"))
  const cache = event.req.method === "GET" && status === 200 && size <= KEEP_MAX_BYTES ? fileCache() : undefined
  if (!cache || !body) return body
  const [sent, copy] = body.tee()
  const headers = new Headers(event.res.headers)
  headers.set("Cache-Control", "public, max-age=31536000, immutable")
  event.waitUntil(
    (async () => (await cache).put(cacheKey(event, blobKey), new Response(copy, { headers })))().catch(() => {}),
  )
  return sent
}

/** The file this request on a content origin asks for, or null when it carries no valid grant for this origin's app. */
export async function serveAppFile(event: H3Event, now = Date.now()): Promise<Response | null> {
  const sealed = getCookie(event, "drop_grant")
  const grant = sealed ? await unseal(event, "app-files", Grant, sealed, 768) : null
  if (!grant || grant.e <= now) return null
  if (!(await onOwnOrigin(event, grant.l))) return null

  let path = event.url.pathname
  try {
    path = decodeURIComponent(path)
  } catch {}
  path = path.replace(/^\/+/, "")
  // Like a static host: a folder's address serves its index.html.
  const candidates = [path, `${path.replace(/\/$/, "")}/index.html`.replace(/^\//, "")].filter(Boolean)

  for (const fresh of [false, true]) {
    const { files, wasKept } = await appFiles(event, grant, now, fresh)
    if (!files) return null
    const file = candidates.find((candidate) => files.has(candidate))
    if (!file) {
      if (wasKept) continue
      return null
    }
    const blobKey = files.get(file)!
    const type = contentTypeOf(file)
    // Private: the grant decides who gets a file, so no shared cache may keep one. `max-age=0, must-revalidate` asks
    // again each time like `no-cache`, but Firefox fails a `<link rel="prefetch">` of a `no-cache` answer.
    const cacheControl = isHashedAsset(file)
      ? "private, max-age=31536000, immutable"
      : "private, max-age=0, must-revalidate"
    const cached = await keptFile(event, blobKey)
    if (cached) {
      const headers = new Headers(cached.headers)
      headers.set("Cache-Control", cacheControl)
      headers.set("X-Robots-Tag", "noindex, nofollow")
      if (cached.status !== 304) headers.set("Content-Type", isTextFile(file) ? `${type}; charset=utf-8` : type)
      return new Response(cached.body, { status: cached.status, headers })
    }
    event.res.headers.set("X-Robots-Tag", "noindex, nofollow")
    // ViteHub streams the file from storage, or just the range a video asks for: Firefox resumes one mid-file and gives
    // up with a network error unless the answer starts where it asked, and Safari won't play one without ranges.
    const [error, body] = await blob.serve(event, blobKey, { cacheControl })
    if (error?.code === "BLOB_NOT_FOUND") {
      if (!wasKept) return null
      continue
    }
    // Not the cacheable 404 a missing file gets: the store failing is brief, and a cached miss would outlast it.
    if (error) {
      useLogger(event).error(error, { action: "storage" })
      return new Response("File storage is temporarily unavailable.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "5" },
      })
    }
    if (body) event.res.headers.set("Content-Type", isTextFile(file) ? `${type}; charset=utf-8` : type)
    const status = event.res.status || 200
    return new Response(event.req.method === "HEAD" ? null : keepFile(event, blobKey, status, body), {
      status,
      headers: event.res.headers,
    })
  }
  return null
}
