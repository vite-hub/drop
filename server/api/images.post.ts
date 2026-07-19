import { assertBodySize, defineHandler, HTTPError, readValidatedBody, requireContentType } from "h3"
import { blob } from "vite-hub/blob"
import { deferQueue } from "vite-hub/queue"
import { defineRateLimit } from "vite-hub/rate-limit"

import { detectImageContentType } from "../image-content-type"

declare const __DROP_ASYNC_OPTIMIZATION__: boolean

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

const imageUploadRateLimit = defineRateLimit("image-upload", {
  failure: "deny",
  limit: 5,
  window: "1m",
})

export default defineHandler(async (event) => {
  await imageUploadRateLimit.enforce()

  requireContentType(event, "multipart/form-data")
  await assertBodySize(event, MAX_IMAGE_BYTES + 64 * 1024)

  const image = await readValidatedBody(event, (body: Record<string, FormDataEntryValue | FormDataEntryValue[]> | undefined) => {
    return body && Object.keys(body).length === 1 && body.image instanceof File ? body.image : false
  }, {
    type: "formData",
    onError: () => ({ status: 400, statusText: "Exactly one image file is required." }),
  })

  if (image.size > MAX_IMAGE_BYTES) throw new HTTPError({ status: 413, statusText: "The image exceeds the 4 MiB limit." })

  const bytes = new Uint8Array(await image.arrayBuffer())
  const contentType = detectImageContentType(bytes)
  if (!contentType) {
    throw new HTTPError({ status: 415, statusText: "Only PNG, JPEG, and WebP images are supported." })
  }

  const id = crypto.randomUUID()

  try {
    await blob.put(id, bytes, {
      access: "private",
      contentType,
    })
  }
  catch (error) {
    console.error(JSON.stringify({ counter: "storage_failure", error: error instanceof Error ? error.message : String(error) }))
    throw new HTTPError({ status: 503, statusText: "Image storage is temporarily unavailable." })
  }

  if (__DROP_ASYNC_OPTIMIZATION__) {
    deferQueue("image-optimization", { payload: id })
  }
  else {
    const { optimizeImage } = await import("../image-optimizer")
    const optimized = await optimizeImage(bytes, contentType)
    if (optimized.byteLength < bytes.byteLength) {
      await blob.put(id, optimized, { access: "private", contentType })
    }
  }

  return { url: `/i/${id}` }
})
