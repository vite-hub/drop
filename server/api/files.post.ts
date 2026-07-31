import { createError } from "evlog"
import { useLogger } from "evlog/nitro/v3"
import { assertBodySize, defineHandler, requireContentType } from "h3"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { kv } from "vite-hub/kv"
import { deferQueue } from "vite-hub/queue"
import { requireRateLimit } from "vite-hub/rate-limit"

const OPTIMIZABLE_IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const MAX_FILE_BYTES = 4 * 1024 * 1024

export default defineHandler(async (event) => {
  const log = useLogger(event)

  await requireRateLimit(event, "file-upload", { failure: "deny", limit: 5, window: "1m" })
  requireContentType(event, "multipart/form-data")
  await assertBodySize(event, MAX_FILE_BYTES + 64 * 1024)

  let form: FormData
  try {
    form = await event.req.formData()
  }
  catch (error) {
    throw createError({
      cause: error instanceof Error ? error : undefined,
      code: "DROP_FILE_REQUIRED",
      message: "Exactly one file is required.",
      status: 400,
    })
  }
  const file = form.get("file")
  if (!(file instanceof File) || form.getAll("file").length !== 1) {
    throw createError({
      code: "DROP_FILE_REQUIRED",
      message: "Exactly one file is required.",
      status: 400,
    })
  }

  if (file.size > MAX_FILE_BYTES) {
    throw createError({
      code: "DROP_FILE_TOO_LARGE",
      message: "The file exceeds the 4 MiB limit.",
      status: 413,
    })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const contentType = detectContentType(bytes) ?? "application/octet-stream"
  const extension = file.name.match(/\.[a-z0-9]{1,16}$/i)?.[0].toLowerCase() ?? ""
  const key = `${crypto.randomUUID()}${extension}`

  const [storageError, stored] = await blob.put(key, bytes, { access: "private", contentType })
  if (storageError || !stored.url) {
    throw createError({
      cause: storageError ?? undefined,
      code: "DROP_FILE_STORAGE_FAILED",
      message: "File storage is temporarily unavailable.",
      status: 503,
    })
  }

  const [statsReadError, uploads] = await kv.get<number>("stats:uploads")
  if (statsReadError) {
    log.error(createError({
      cause: statsReadError,
      code: "DROP_UPLOAD_STATS_READ_FAILED",
      message: "Upload statistics could not be read.",
    }))
  }
  else {
    const [statsWriteError] = await kv.set("stats:uploads", (uploads ?? 0) + 1)
    if (statsWriteError) {
      log.error(createError({
        cause: statsWriteError,
        code: "DROP_UPLOAD_STATS_WRITE_FAILED",
        message: "Upload statistics could not be updated.",
      }))
    }
  }

  if (OPTIMIZABLE_IMAGE_CONTENT_TYPES.has(contentType))
    deferQueue("image-optimization", { payload: key })

  return { url: new URL(stored.url, event.req.url).href }
})
