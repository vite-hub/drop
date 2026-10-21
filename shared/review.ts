// Site review: a site drop stands for a live website (a preview deploy, staging, a dev server). Its pages load Drop's
// review script, and what people send from there lands in Drop as comments with screenshots.

/** How long a review token lasts. The connect popup issues a new one when it runs out. */
export const REVIEW_TOKEN_HOURS = 12

/** The longest page address a review comment keeps: path, query, and hash. */
export const MAX_REVIEW_PAGE = 1000

export const isLocal = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost")

/** One host label, as browsers write it in an origin: lowercase letters, digits, dashes (punycode included). */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** An origin a site may send from: https, or plain http on this computer, where dev servers run. Null otherwise. */
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

/**
 * The address a site drop covers, or null when `url` can't be one. Either an exact origin
 * (`https://pr12-acme.preview.quiver.dk`) or a pattern whose first label is `*` (`https://*.preview.quiver.dk`), which
 * covers any one label there: not deeper levels, and not the bare domain. A pattern needs at least two labels after the
 * `*`, so it never covers a whole top-level domain, except `*.localhost`.
 */
export function siteAddress(url: string): string | null {
  const text = url.trim()
  // Like an origin, a pattern may come with a path, which it drops.
  const wild = text.match(/^(https?:\/\/)\*\.([^/?#*]+)(?:[/?#][^*]*)?$/i)
  if (!wild) return text.includes("*") ? null : exactOrigin(text)
  // Parsed with a stand-in label, so the URL parser checks and normalizes the rest of the host and the port.
  const sample = exactOrigin(`${wild[1]}x.${wild[2]}`)
  if (!sample) return null
  const host = new URL(sample).hostname
  const rest = host.slice(2).split(".")
  if (!host.startsWith("x.") || /^\d+$/.test(rest.at(-1)!) || (rest.length < 2 && host !== "x.localhost")) return null
  return sample.replace("://x.", "://*.")
}

/** What `siteAddress` takes, for the people who typed something else. */
export const SITE_ADDRESS_RULE =
  "Use https, or http on localhost. A pattern starts with *. and covers one label, like https://*.preview.example.com."

/** Whether a page's origin is one the site drop covers (see `siteAddress`). */
export function siteMatches(address: string, origin: string): boolean {
  if (exactOrigin(origin) !== origin) return false
  if (!address.includes("*")) return address === origin
  const [prefix, suffix] = address.split("*.")
  if (prefix === undefined || suffix === undefined || !origin.startsWith(prefix) || !origin.endsWith(`.${suffix}`))
    return false
  return LABEL.test(origin.slice(prefix.length, origin.length - suffix.length - 1))
}

/**
 * Every address that covers `origin`: the origin itself and the one pattern that could, so a lookup finds the site
 * drops for a page by equality. Empty for anything that isn't an origin a site may send from.
 */
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

/** What a site drop is called by default: its host, or its pattern's. */
export const siteHost = (address: string) => address.replace(/^https?:\/\//, "")

/**
 * The tag a site may add to its preview builds. It carries no key: the script finds Drop from its own src, and Drop
 * finds the site drop from the page's origin once someone connects.
 */
export const reviewSnippet = (dropOrigin: string) => `<script src="${dropOrigin}/review.js" defer></script>`

/** A bookmarklet that adds the same script to whatever page the reviewer has open, so the site needs no change. */
export const reviewBookmarklet = (dropOrigin: string) =>
  `javascript:(function(){var s=document.createElement("script");s.src=${JSON.stringify(`${dropOrigin}/review.js`)};document.documentElement.appendChild(s)})()`
