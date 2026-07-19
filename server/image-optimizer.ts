import sharp from "sharp"

import type { ImageContentType } from "./image-content-type"

const IMAGE_FORMATS = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
} as const

export async function optimizeImage(bytes: Uint8Array, contentType: ImageContentType) {
  return new Uint8Array(await sharp(bytes)
    .rotate()
    .resize({ fit: "inside", height: 2048, width: 2048, withoutEnlargement: true })
    .toFormat(IMAGE_FORMATS[contentType])
    .toBuffer())
}
