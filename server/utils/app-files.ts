import { eq } from "drizzle-orm"
import { useLogger } from "evlog/nitro/v3"
import { getCookie, type H3Event } from "h3"
import * as v from "valibot"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
import { contentTypeOf, isTextFile } from "#shared/project-bundle"
import { dropFiles } from "../databases/config"
import { onOwnOrigin } from "./content-origin"
import { findDrop } from "./drops"
import { seal, unseal } from "./review"

/**
 * An app's files, served from its own content origin like any static host, so a built app's module chunks, fonts,
 * wasm and fetch() calls load as they were built to. The origin has no session: the viewer, which checked the person
 * may open the drop, hands the frame a grant (FRAME_HOST_HTML keeps it as a cookie). A grant names the drop's link
 * (or its id, before links), and only that link's own origin takes it, so one app can't use another's grant to read its files.
 */

const GRANT_MS = 12 * 3_600_000
const Grant = v.object({ l: v.string(), e: v.number() })

/** A grant to the files of the app behind `link`, for whoever may view it now. */
export const appFilesGrant = (event: H3Event, link: string, now = Date.now()) =>
  seal(event, "app-files", { l: link, e: now + GRANT_MS } satisfies v.InferOutput<typeof Grant>)

/**
 * Where each of an app's files is, for its content origin. A page load asks for dozens of files at once, so each
 * isolate keeps the answer for a few seconds and shares one lookup between them, instead of two queries per file that
 * queue up on the database. A drop moved to the Trash or republished shows within that window; a path the kept answer
 * lacks, or a file the store no longer has, looks again at once (serveAppFile).
 */
const KEEP_MS = 5_000
// Workers stop a request's I/O when its client goes away, so a lookup another request started may never settle; a
// request that waits this long on one looks up for itself.
const SHARED_WAIT_MS = 1_000
type AppFiles = Map<string, string> | null
const kept = new Map<string, { at: number; files: Promise<AppFiles> }>()

/** The app's files, and whether they were kept from an earlier request rather than looked up for this one. */
async function appFiles(event: H3Event, link: string, now: number, fresh: boolean) {
  const entry = kept.get(link)
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
  const files = lookUpAppFiles(event, link)
  for (const [key, old] of kept) if (now - old.at >= KEEP_MS) kept.delete(key)
  kept.set(link, { at: now, files })
  // A failed lookup isn't kept: the next file asks again.
  files.catch(() => kept.get(link)?.files === files && kept.delete(link))
  return { files: await files, wasKept: false }
}

async function lookUpAppFiles(event: H3Event, link: string): Promise<AppFiles> {
  const drop = await findDrop(link, event)
  if (!drop || drop.kind !== "app" || drop.trashedAt !== null || drop.expired) return null
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
 */
export function isHashedAsset(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1)
  return name
    .split(".")
    .slice(0, -1)
    .flatMap((part) => part.split("-"))
    .some(
      (token) =>
        token.length >= 8 &&
        /^\w+$/.test(token) &&
        /\d/.test(token) &&
        (/^[\da-f]+$/.test(token) ? /[a-f]/.test(token) : /[a-z]/.test(token) && /[A-Z]/.test(token)),
    )
}

/** The file this request on a content origin asks for, or null when it carries no valid grant for this origin's app. */
export async function serveAppFile(event: H3Event, now = Date.now()): Promise<Response | null> {
  const sealed = getCookie(event, "drop_grant")
  const grant = sealed ? await unseal(event, "app-files", Grant, sealed, 512) : null
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
    const { files, wasKept } = await appFiles(event, grant.l, now, fresh)
    if (!files) return null
    const file = candidates.find((candidate) => files.has(candidate))
    if (!file) {
      if (wasKept) continue
      return null
    }
    const blobKey = files.get(file)!
    // Every publish writes its files under a new folder, so that folder names this content.
    const etag = `"${blobKey.split("/")[2] ?? "0"}"`
    const type = contentTypeOf(file)
    const headers = {
      "Content-Type": isTextFile(file) ? `${type}; charset=utf-8` : type,
      // Private: the grant decides who gets a file, so no shared cache may keep one.
      "Cache-Control": isHashedAsset(file) ? "private, max-age=31536000, immutable" : "private, no-cache",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    }
    if (event.req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers })
    const [error, body] = await blob.get(blobKey)
    // Not the cacheable 404 a missing file gets: the store failing is brief, and a cached miss would outlast it.
    if (error && error.code !== "BLOB_NOT_FOUND") {
      useLogger(event).error(error, { action: "storage" })
      return new Response("File storage is temporarily unavailable.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "5" },
      })
    }
    if (body) return new Response(event.req.method === "HEAD" ? null : body.stream(), { headers })
    if (!wasKept) return null
  }
  return null
}
