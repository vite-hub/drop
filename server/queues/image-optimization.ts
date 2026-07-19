import { runSandbox } from "vite-hub/sandbox"

import { blob } from "vite-hub/blob"
import { defineQueue } from "vite-hub/queue"
import * as v from "valibot"

import { detectImageContentType, IMAGE_CONTENT_TYPES } from "../image-content-type"

const payloadSchema = v.object({
  contentType: v.picklist(IMAGE_CONTENT_TYPES),
  id: v.pipe(v.string(), v.uuid()),
})

export default defineQueue(async ({ attempts, payload }) => {
  const parsed = v.safeParse(payloadSchema, payload)
  if (!parsed.success) {
    console.error(JSON.stringify({ counter: "optimization_invalid_payload" }))
    return
  }

  const image = parsed.output

  try {
    const original = await blob.get(image.id)
    if (!original) throw new Error("Original image is missing.")

    const originalBytes = new Uint8Array(await original.arrayBuffer())
    const result = await runSandbox("image-optimizer", {
      bytes: encodeBase64(originalBytes),
      contentType: image.contentType,
    })
    if ("error" in result) throw result.error

    const candidate = decodeBase64(result.value.bytes)
    if (!candidate.byteLength || detectImageContentType(candidate) !== image.contentType) {
      throw new Error("Sandbox returned an invalid image.")
    }

    if (candidate.byteLength < originalBytes.byteLength) {
      await blob.put(image.id, candidate, { access: "private", contentType: image.contentType })
    }
  }
  catch (error) {
    console.error(JSON.stringify({
      attempts,
      counter: "optimization_failure",
      error: error instanceof Error ? error.message : String(error),
      key: image.id,
    }))
    if (attempts < 3) throw error
  }
}, { concurrency: 1 })

function encodeBase64(bytes: Uint8Array) {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return btoa(binary)
}

function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}
