import { useServerEnv } from "#vitehub/env/server"
import { assertBodySize, defineHandler, getRequestIP, HTTPError, readBody, requireContentType } from "h3"
import { blob } from "vite-hub/blob"
import { detectContentType } from "vite-hub/blob/content-type"
import { kv } from "vite-hub/kv"
import { runQueue } from "vite-hub/queue"
import { defineRateLimit } from "vite-hub/rate-limit"

import { type ImageContentType, imageJobKey, type QueuedImageJob } from "../image-job"

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

const imageUploadRateLimit = defineRateLimit("image-upload", {
  failure: "deny",
  limit: 5,
  window: "1m",
})

const supportedContentTypes = new Set<ImageContentType>(["image/jpeg", "image/png", "image/webp"])

export default defineHandler(async (event) => {
  await imageUploadRateLimit.enforce(getRequestIP(event))

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
  if (!contentType || !supportedContentTypes.has(contentType as ImageContentType)) {
    throw new HTTPError({ status: 415, statusText: "Only PNG, JPEG, and WebP images are supported." })
  }

  const id = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const job: QueuedImageJob = {
    contentType: contentType as ImageContentType,
    createdAt,
    id,
    originalSize: bytes.byteLength,
    status: "queued",
  }

  try {
    await blob.put(id, bytes, {
      access: "private",
      contentType,
      customMetadata: {
        contentType,
        createdAt,
        originalSize: String(bytes.byteLength),
        status: "queued",
      },
    })
    await kv.set(imageJobKey(id), job)
  }
  catch (error) {
    console.error(JSON.stringify({ counter: "storage_failure", error: error instanceof Error ? error.message : String(error) }))
    await Promise.allSettled([blob.del(id), kv.del(imageJobKey(id))])
    throw new HTTPError({ status: 503, statusText: "Image storage is temporarily unavailable." })
  }

  try {
    await runQueue("image-optimization", { payload: job })
  }
  catch (error) {
    console.error(JSON.stringify({ counter: "queue_dispatch_failure", error: error instanceof Error ? error.message : String(error), key: id }))
    await Promise.allSettled([blob.del(id), kv.del(imageJobKey(id))])
    throw new HTTPError({ status: 503, statusText: "Image optimization is temporarily unavailable." })
  }

  const origin = useServerEnv(event).dropOrigin.replace(/\/$/, "")
  return {
    contentType,
    id,
    size: bytes.byteLength,
    status: "queued",
    statusUrl: `${origin}/api/images/${id}`,
  }
})
