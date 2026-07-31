export const CODE_IMAGE_PREFIX = "code-images/"
export const CODE_IMAGE_FORMATS = ["png", "svg"] as const
export const CODE_IMAGE_SCALES = [2, 4, 6] as const
export const MAX_CODE_CHARACTERS = 20_000

export type CodeImageFormat = typeof CODE_IMAGE_FORMATS[number]
export type CodeImageScale = typeof CODE_IMAGE_SCALES[number]

const CODE_IMAGE_TTL_MS = 5 * 60 * 1000

export function createCodeImageLocation(format: CodeImageFormat, now = new Date()) {
  const expiresAt = new Date(now.getTime() + CODE_IMAGE_TTL_MS)
  return {
    expiresAt,
    key: `${CODE_IMAGE_PREFIX}${expiresAt.getTime()}/${crypto.randomUUID()}.${format}`,
  }
}

export function isExpiredCodeImage(pathname: string, now: Date) {
  if (!pathname.startsWith(CODE_IMAGE_PREFIX))
    return false

  const expiryEnd = pathname.indexOf("/", CODE_IMAGE_PREFIX.length)
  if (expiryEnd === -1)
    return false

  const expiresAt = Number(pathname.slice(CODE_IMAGE_PREFIX.length, expiryEnd))
  return Number.isSafeInteger(expiresAt) && expiresAt <= now.getTime()
}
