import { eq } from "drizzle-orm"
import { useLogger } from "evlog/nitro/v3"
import { getCookie, type H3Event } from "h3"
import * as v from "valibot"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database"
import { contentTypeOf, isTextFile } from "#shared/project-bundle"
import { dropFiles } from "../databases/default/index"
import { onOwnOrigin } from "./content-origin"
import { findDrop, permissions } from "./drops"
import { identityOf, type Identity } from "./identity"
import { seal, unseal } from "./review"

const GRANT_MS = 12 * 3_600_000
const Grant = v.object({ l: v.string(), u: v.nullable(v.string()), e: v.number() })

export const appFilesGrant = (event: H3Event, link: string, who: Identity | null, now = Date.now()) =>
  seal(event, "app-files", { l: link, u: who?.userId ?? null, e: now + GRANT_MS } satisfies v.InferOutput<typeof Grant>)

const KEEP_MS = 5_000
const SHARED_WAIT_MS = 1_000
type AppFiles = Map<string, string> | null
const kept = new Map<string, { at: number; files: Promise<AppFiles> }>()

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
        return (
          !!hash &&
          /[a-z]/.test(hash) &&
          /[A-Z]/.test(hash) &&
          !/^(?:(?:[a-z]+)?(?:[A-Z][a-z]+)+|[A-Z]{2,}[a-z]+)$/.test(hash)
        )
      }))
  )
}

const BUILD_FOLDER = /(?:^|\/)(?:_nuxt|assets|_astro|immutable|_next\/static)\/(?:.*\/)?$/

const KEEP_MAX_BYTES = 25 * 1024 * 1024

function fileCache() {
  return "caches" in globalThis && "default" in caches ? caches.open("drop-app-files") : undefined
}

function cacheKey(event: H3Event, blobKey: string, headers?: HeadersInit) {
  return new Request(`${event.url.origin}/_drop-app-files/${encodeURIComponent(blobKey)}`, { headers })
}

async function keptFile(event: H3Event, blobKey: string): Promise<Response | undefined> {
  if (event.req.method !== "GET" || event.req.headers.has("if-range")) return
  const cache = await fileCache()
  if (!cache) return
  const headers = new Headers()
  for (const name of ["range", "if-none-match", "if-modified-since"]) {
    const value = event.req.headers.get(name)
    if (value) headers.set(name, value)
  }
  return cache.match(cacheKey(event, blobKey, headers)).catch(() => undefined)
}

function keepFile(event: H3Event, blobKey: string, status: number, body: ReadableStream | null, headers: Headers) {
  const size = Number(headers.get("Content-Length"))
  const cache = event.req.method === "GET" && status === 200 && size <= KEEP_MAX_BYTES ? fileCache() : undefined
  if (!cache || !body) return body
  const [sent, copy] = body.tee()
  const forever = new Headers(headers)
  forever.set("Cache-Control", "public, max-age=31536000, immutable")
  event.waitUntil(
    (async () => (await cache).put(cacheKey(event, blobKey), new Response(copy, { headers: forever })))().catch(
      () => {},
    ),
  )
  return sent
}

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
    let served: Response
    try {
      served = await blob.serve(event.req, blobKey, { cacheControl, headers: { "X-Robots-Tag": "noindex, nofollow" } })
    } catch (error) {
      useLogger(event).error(error instanceof Error ? error : String(error), { action: "storage" })
      return new Response("File storage is temporarily unavailable.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "5" },
      })
    }
    if (served.status === 404) {
      if (!wasKept) return null
      continue
    }
    const headers = new Headers(served.headers)
    if (served.body) headers.set("Content-Type", isTextFile(file) ? `${type}; charset=utf-8` : type)
    return new Response(
      event.req.method === "HEAD" ? null : keepFile(event, blobKey, served.status, served.body, headers),
      { status: served.status, headers },
    )
  }
  return null
}
