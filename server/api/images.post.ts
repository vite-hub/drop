import { blob } from "@vite-hub/blob"
import { detectContentType } from "@vite-hub/blob/content-type"
import { runQueue } from "@vite-hub/queue"
import { defineRateLimit } from "@vite-hub/rate-limit"
import { assertBodySize, defineHandler, getRequestIP, HTTPError, readBody, requireContentType } from "h3"
import { useRuntimeConfig } from "nitro/runtime-config"

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const EXPIRY_SECONDS = 23 * 60 * 60 + 55 * 60

const imageUploadRateLimit = defineRateLimit("image-upload", {
  failure: "deny",
  limit: 5,
  window: "1m",
})

const formats = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const

export default defineHandler(async (event) => {
  let rateLimit
  try {
    rateLimit = await imageUploadRateLimit.consume(getRequestIP(event))
  }
  catch (error) {
    console.error(JSON.stringify({ counter: "rate_limit_failure", error: error instanceof Error ? error.message : String(error) }))
    throw new HTTPError({ status: 503, statusText: "Upload rate limiting is unavailable." })
  }
  if (!rateLimit.allowed) {
    throw new HTTPError({
      headers: { "Retry-After": String(rateLimit.retryAfter || 60) },
      status: 429,
      statusText: "Upload rate limit exceeded.",
    })
  }

  requireContentType(event, "multipart/form-data")
  await assertBodySize(event, MAX_IMAGE_BYTES + 64 * 1024)

  const body = await readBody<Record<string, FormDataEntryValue | FormDataEntryValue[]>>(event, { type: "formData" })
  if (!body || Object.keys(body).some(name => name !== "image")) {
    throw new HTTPError({ status: 400, statusText: "Unexpected multipart field." })
  }

  const image = body.image
  if (!(image instanceof File)) {
    throw new HTTPError({ status: 400, statusText: "Exactly one image file is required." })
  }

  if (image.size > MAX_IMAGE_BYTES) throw new HTTPError({ status: 413, statusText: "The image exceeds the 4 MiB limit." })

  const bytes = new Uint8Array(await image.arrayBuffer())
  const contentType = detectContentType(bytes)
  const format = formats[contentType as keyof typeof formats]
  if (!format) throw new HTTPError({ status: 415, statusText: "Only PNG, JPEG, and WebP images are supported." })

  const id = crypto.randomUUID()
  const key = `${id}.${format}`
  const expiresAt = new Date(Date.now() + EXPIRY_SECONDS * 1000).toISOString()

  try {
    await blob.put(key, bytes, { access: "private", contentType })
  }
  catch (error) {
    console.error(JSON.stringify({ counter: "storage_failure", error: error instanceof Error ? error.message : String(error) }))
    throw new HTTPError({ status: 503, statusText: "Image storage is temporarily unavailable." })
  }

  try {
    await runQueue("image-expiry", { contentType: "json", delaySeconds: EXPIRY_SECONDS, payload: { key } })
  }
  catch (error) {
    console.error(JSON.stringify({ counter: "queue_dispatch_failure", error: error instanceof Error ? error.message : String(error), key }))
    await blob.del(key).catch(() => console.error(JSON.stringify({ counter: "upload_cleanup_failure", key })))
    throw new HTTPError({ status: 503, statusText: "Image expiry scheduling is temporarily unavailable." })
  }

  const origin = String(useRuntimeConfig().dropOrigin).replace(/\/$/, "")
  const url = `${origin}/i/${key}`

  return {
    contentType,
    expiresAt,
    id,
    size: bytes.byteLength,
    url,
  }
})
