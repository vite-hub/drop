import { assertBodySize, defineHandler, HTTPError, readValidatedBody, requireContentType } from "h3"
import { blob } from "vite-hub/blob"

import { detectImageContentType } from "../image-content-type"
import { optimizeStoredImage } from "../image-optimization"
import { enforceUploadRateLimit } from "../upload-policy"

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
export default defineHandler(async (event) => {
  await enforceUploadRateLimit(event)

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

  await optimizeStoredImage(id, bytes, contentType)
  return { url: `/i/${id}` }
})
