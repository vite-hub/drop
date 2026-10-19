export function needsShareReview(
  enabled: boolean,
  owner?: { role?: string | null; shareApprovedAt?: number | null; banned?: boolean | null },
) {
  if (!enabled) return false
  return !owner || Boolean(owner.banned) || !(owner.role === "admin" || owner.shareApprovedAt != null)
}

export function reportTarget(value: string) {
  // A share link's slug only reads well; the drop is the key before it.
  value = value.replace(/^(\/d\/[^/?#]+)\/[^/?#]*$/, "$1")
  if (!/^\/(?:d\/[^/?#]+|f\/[^?#]+)$/.test(value) || value.length > 600) return null
  try {
    const canonical = new URL(value, "https://drop.invalid").pathname
    if (canonical !== value) return null
    if (value.startsWith("/f/")) {
      const key = decodeURIComponent(value.slice(3))
      if (key.split("/").some((part) => part === "." || part === "..")) return null
      return `/f/${key.split("/").map(encodeURIComponent).join("/")}`
    }
    return canonical
  } catch {
    return null
  }
}
