import { runSandbox } from "vite-hub/sandbox"

import { blob } from "vite-hub/blob"
import { defineQueue } from "vite-hub/queue"

import { detectImageContentType, type ImageContentType } from "../image-content-type"

export default defineQueue<string>(async ({ payload: id }) => {
  const original = await blob.get(id)
  if (!original) throw new Error("Original image is missing.")

  const originalBytes = Buffer.from(await original.arrayBuffer())
  const contentType = original.type as ImageContentType
  const result = await runSandbox("image-optimizer/image-optimizer", {
    bytes: originalBytes.toString("base64"),
    contentType,
  })
  if ("error" in result) throw result.error

  const optimized = Buffer.from(result.value.bytes, "base64")
  if (detectImageContentType(optimized) !== contentType) {
    throw new Error("Sandbox returned an invalid image.")
  }

  if (optimized.byteLength < originalBytes.byteLength) {
    await blob.put(id, optimized, { access: "private", contentType })
  }
}, { onError: error => console.error(error) })
