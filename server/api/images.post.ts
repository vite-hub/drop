import { assertBodySize, defineHandler, HTTPError, readBody, requireContentType } from "h3"
import { blob } from "vite-hub/blob"
import { runQueue } from "vite-hub/queue"
import { defineRateLimit } from "vite-hub/rate-limit"

import { detectImageContentType, type ImageContentType } from "../image-content-type"

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

  await enqueueOptimization({ contentType, id })

  return { url: `/i/${id}` }
})

async function enqueueOptimization(image: { contentType: ImageContentType, id: string }) {
  try {
    await runQueue("image-optimization", { payload: image })
  }
  catch (error) {
    console.error(JSON.stringify({ counter: "queue_dispatch_failure", error: error instanceof Error ? error.message : String(error), key: image.id }))
  }
}
