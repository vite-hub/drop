import { useLogger } from "evlog/nitro/v3"
import { defineHandler, HTTPError, requireContentType } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import { createDocDrop, dropPageUrl, MAX_FILE_BYTES } from "../utils/drops"
import { requireIdentity } from "../utils/identity"

/** Agents upload one file. It becomes a private drop; `url` serves the file, `page` opens it for review. */
export default defineHandler(async (event) => {
  const who = await requireIdentity(event).catch(async (error) => {
    // Release the unread upload before answering, or the connection can drop mid-stream instead of a clean 401.
    await event.req.body?.cancel().catch(() => {})
    throw error
  })
  // Cloudflare Rate Limiting only exists on Workers; local dev skips it.
  if (!import.meta.dev) await requireRateLimit(event, "file-upload", { failure: "deny", key: who.userId, limit: 30, window: "1m" })
  requireContentType(event, "multipart/form-data")
  // Checked from the header: h3's assertBodySize rewraps the request and drops its multipart content type.
  if (Number(event.req.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 64 * 1024)
    throw new HTTPError({ status: 413, statusText: "The file exceeds the 4 MiB limit." })

  let form: FormData
  try {
    form = await event.req.formData()
  }
  catch {
    throw new HTTPError({ status: 400, statusText: "Exactly one file is required." })
  }
  const file = form.get("file")
  if (!(file instanceof File) || form.getAll("file").length !== 1)
    throw new HTTPError({ status: 400, statusText: "Exactly one file is required." })
  if (file.size > MAX_FILE_BYTES) throw new HTTPError({ status: 413, statusText: "The file exceeds the 4 MiB limit." })

  const title = form.get("title")
  const supersedes = form.get("supersedes")
  const drop = await createDocDrop(who, {
    filename: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    title: typeof title === "string" ? title : undefined,
    supersedes: typeof supersedes === "string" ? supersedes : undefined,
  })
  useLogger(event).set({ drop: { id: drop.id, kind: drop.kind, size: drop.size, version: drop.version } })
  const origin = event.url.origin
  return {
    id: drop.id,
    url: new URL(`/f/${drop.blobKey}`, origin).href,
    page: dropPageUrl(origin, drop.id),
    visibility: drop.visibility,
    version: drop.version,
  }
})
