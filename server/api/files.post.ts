import { assertBodySize, defineHandler, HTTPError, requireContentType } from "h3"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { kv } from "vite-hub/kv"
import { deferQueue } from "vite-hub/queue"
import { requireRateLimit } from "vite-hub/rate-limit"

const OPTIMIZABLE_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const MAX_FILE_BYTES = 4 * 1024 * 1024

export default defineHandler(async (event) => {
  await requireRateLimit(event, "file-upload", { failure: "deny", limit: 5, window: "1m" })
  requireContentType(event, "multipart/form-data")
  await assertBodySize(event, MAX_FILE_BYTES + 64 * 1024)

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

  const bytes = new Uint8Array(await file.arrayBuffer())
  const contentType = detectContentType(bytes) ?? "application/octet-stream"
  const id = crypto.randomUUID()

  const [storageError, stored] = await blob.put(id, bytes, { access: "private", contentType })
  if (storageError || !stored.url) {
    console.error(JSON.stringify({ counter: "storage_failure", error: storageError?.message || "No url" }))
    throw new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable." })
  }

  const [statsReadError, uploads] = await kv.get<number>("stats:uploads")
  if (statsReadError) {
    console.error(JSON.stringify({ counter: "stats_failure", error: statsReadError.message }))
  }
  else {
    const [statsWriteError] = await kv.set("stats:uploads", (uploads ?? 0) + 1)
    if (statsWriteError)
      console.error(JSON.stringify({ counter: "stats_failure", error: statsWriteError.message }))
  }

  if (OPTIMIZABLE_IMAGE_CONTENT_TYPES.has(contentType))
    deferQueue("image-optimization", { payload: id })

  return { url: new URL(stored.url, event.req.url).href }
})
