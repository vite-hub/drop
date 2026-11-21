export const REVIEW_TOKEN_HOURS = 12

export const MAX_REVIEW_PAGE = 1000

export const isLocal = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost")

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function exactOrigin(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.username || parsed.password) return null
  if (parsed.protocol === "https:") return parsed.origin
  return parsed.protocol === "http:" && isLocal(parsed.hostname) ? parsed.origin : null
}

export function siteAddress(url: string): string | null {
  const text = url.trim()
  const wild = text.match(/^(https?:\/\/)\*\.([^/?#*]+)(?:[/?#][^*]*)?$/i)
  if (!wild) return text.includes("*") ? null : exactOrigin(text)
  const sample = exactOrigin(`${wild[1]}x.${wild[2]}`)
  if (!sample) return null
  const host = new URL(sample).hostname
  const rest = host.slice(2).split(".")
  if (!host.startsWith("x.") || /^\d+$/.test(rest.at(-1)!) || (rest.length < 2 && host !== "x.localhost")) return null
  return sample.replace("://x.", "://*.")
}

export const SITE_ADDRESS_RULE =
  "Use https, or http on localhost. A pattern starts with *. and covers one label, like https://*.preview.example.com."

export function siteMatches(address: string, origin: string): boolean {
  if (exactOrigin(origin) !== origin) return false
  if (!address.includes("*")) return address === origin
  const [prefix, suffix] = address.split("*.")
  if (prefix === undefined || suffix === undefined || !origin.startsWith(prefix) || !origin.endsWith(`.${suffix}`))
    return false
  return LABEL.test(origin.slice(prefix.length, origin.length - suffix.length - 1))
}

export function siteCovers(siteUrl: string | null | undefined, address: string): boolean {
  return !!siteUrl && URL.canParse(address) && siteMatches(siteUrl, new URL(address).origin)
}

export function siteAddressesFor(origin: string): string[] {
  if (exactOrigin(origin) !== origin) return []
  const { protocol, hostname, port } = new URL(origin)
  const dot = hostname.indexOf(".")
  const pattern =
    dot > 0 && !hostname.startsWith("[")
      ? siteAddress(`${protocol}//*.${hostname.slice(dot + 1)}${port ? `:${port}` : ""}`)
      : null
  return pattern ? [origin, pattern] : [origin]
}

export const isSitePattern = (address: string) => address.includes("*")

export const siteHost = (address: string) => address.replace(/^https?:\/\//, "")

export const reviewSnippet = (dropOrigin: string) => `<script src="${dropOrigin}/review.js" defer></script>`

export const reviewBookmarklet = (dropOrigin: string) =>
  `javascript:(function(){var s=document.createElement("script");s.src=${JSON.stringify(`${dropOrigin}/review.js`)};document.documentElement.appendChild(s)})()`
