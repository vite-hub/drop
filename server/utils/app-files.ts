import { and, eq, inArray } from "drizzle-orm"
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

/** The file this request on a content origin asks for, or null when it carries no valid grant for this origin's app. */
export async function serveAppFile(event: H3Event, now = Date.now()): Promise<Response | null> {
  const sealed = getCookie(event, "drop_grant")
  const grant = sealed ? await unseal(event, "app-files", Grant, sealed, 512) : null
  if (!grant || grant.e <= now) return null
  if (!(await onOwnOrigin(event, grant.l))) return null
  const drop = await findDrop(grant.l, event)
  if (!drop || drop.kind !== "app" || drop.trashedAt !== null || drop.expired) return null

  let path = event.url.pathname
  try {
    path = decodeURIComponent(path)
  } catch {}
  path = path.replace(/^\/+/, "")
  // Like a static host: a folder's address serves its index.html.
  const candidates = [path, `${path.replace(/\/$/, "")}/index.html`.replace(/^\//, "")].filter(Boolean)
  const rows = await db
    .select({ path: dropFiles.path, blobKey: dropFiles.blobKey })
    .from(dropFiles)
    .where(and(eq(dropFiles.dropId, drop.id), inArray(dropFiles.path, candidates)))
  const file = candidates.map((candidate) => rows.find((row) => row.path === candidate)).find(Boolean)
  if (!file) return null

  // Every publish writes its files under a new folder, so that folder names this content.
  const etag = `"${file.blobKey.split("/")[2] ?? "0"}"`
  const type = contentTypeOf(file.path)
  const headers = {
    "Content-Type": isTextFile(file.path) ? `${type}; charset=utf-8` : type,
    "Cache-Control": "private, no-cache",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  }
  if (event.req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers })
  const [error, body] = await blob.get(file.blobKey)
  // Not the cacheable 404 a missing file gets: the store failing is brief, and a cached miss would outlast it.
  if (error && error.code !== "BLOB_NOT_FOUND") {
    useLogger(event).error(error, { action: "storage" })
    return new Response("File storage is temporarily unavailable.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "5" },
    })
  }
  if (!body) return null
  return new Response(event.req.method === "HEAD" ? null : body.stream(), { headers })
}
