import { blob } from "vite-hub/blob"

import type { ImageContentType } from "./image-content-type"

declare const __DROP_ISOLATED_OPTIMIZATION__: boolean

export async function optimizeStoredImage(
  id: string,
  bytes: Uint8Array,
  contentType: ImageContentType,
) {
  if (__DROP_ISOLATED_OPTIMIZATION__) {
    const { deferQueue } = await import("vite-hub/queue")
    deferQueue("image-optimization", { payload: id })
    return
  }

  const { optimizeImage } = await import("./image-optimizer")
  const optimized = await optimizeImage(bytes, contentType)
  if (optimized.byteLength < bytes.byteLength) {
    await blob.put(id, optimized, { access: "private", contentType })
  }
}
