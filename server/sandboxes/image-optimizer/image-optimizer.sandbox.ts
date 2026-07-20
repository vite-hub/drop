import { defineSandbox } from "@vite-hub/sandbox"
import sharp from "sharp"

type ImageContentType = "image/jpeg" | "image/png" | "image/webp"

type ImageOptimizationPayload = {
  bytes: string
  contentType: ImageContentType
}

const IMAGE_FORMATS = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
} as const

export default defineSandbox({
  timeout: 60_000,
  async run(payload?: ImageOptimizationPayload) {
    if (!payload) throw new TypeError("Image optimization requires a payload.")

    const optimized = await sharp(Buffer.from(payload.bytes, "base64"))
      .rotate()
      .resize({
        fit: "inside",
        height: 2048,
        width: 2048,
        withoutEnlargement: true,
      })
      .toFormat(IMAGE_FORMATS[payload.contentType])
      .toBuffer()

    return {
      bytes: optimized.toString("base64"),
    }
  },
})
