import { readFile } from "node:fs/promises"
import sharp from "sharp"

type ImageContentType = "image/jpeg" | "image/png" | "image/webp"

export interface SandboxPayload {
  bytes: string
  contentType: ImageContentType
}

const IMAGE_FORMATS = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
} as const

const inputPath = process.argv[2]
if (!inputPath) throw new TypeError("Sandbox input path is required.")

const { payload } = JSON.parse(await readFile(inputPath, "utf8")) as {
  payload?: SandboxPayload
}

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

export default {
  bytes: optimized.toString("base64"),
}
