export const CODE_IMAGE_PREFIX = "code-images/"

const CODE_IMAGE_TTL_MS = 5 * 60 * 1000

export function createCodeImageObject(now = new Date()) {
  const expiresAt = new Date(now.getTime() + CODE_IMAGE_TTL_MS)
  return {
    expiresAt,
    key: `${CODE_IMAGE_PREFIX}${expiresAt.getTime()}/${crypto.randomUUID()}.png`,
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
