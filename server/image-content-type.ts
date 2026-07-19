export const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

export type ImageContentType = typeof IMAGE_CONTENT_TYPES[number]

export function imageExtension(contentType: ImageContentType) {
  switch (contentType) {
    case "image/jpeg": return "jpg"
    case "image/png": return "png"
    case "image/webp": return "webp"
  }
}

export function detectImageContentType(bytes: Uint8Array): ImageContentType | undefined {
  if (matches(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg"
  if (matches(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])) return "image/png"
  if (matches(bytes, 0, [82, 73, 70, 70]) && matches(bytes, 8, [87, 69, 66, 80])) return "image/webp"
}

function matches(bytes: Uint8Array, offset: number, signature: number[]) {
  return bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte)
}
