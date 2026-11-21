export function needsShareReview(
  enabled: boolean,
  owner?: { role?: string | null; shareApprovedAt?: number | null; banned?: boolean | null },
) {
  if (!enabled) return false
  return !owner || Boolean(owner.banned) || !(owner.role === "admin" || owner.shareApprovedAt != null)
}

export function fileReportTarget(key: string) {
  return `/f/${key.split("/").map(encodeURIComponent).join("/")}`
}

export function reportTarget(value: string) {
  value = value.replace(/^(\/d\/[^/?#]+)\/[^/?#]*$/, "$1")
  if (!/^\/(?:d\/[^/?#]+|f\/[^?#]+)$/.test(value) || value.length > 600) return null
  try {
    const canonical = new URL(value, "https://drop.invalid").pathname
    if (canonical !== value) return null
    if (value.startsWith("/f/")) {
      const key = decodeURIComponent(value.slice(3)).replace(/^\/+/, "")
      if (!key || key.split("/").some((part) => part === "." || part === "..")) return null
      return fileReportTarget(key)
    }
    return canonical
  } catch {
    return null
  }
}
