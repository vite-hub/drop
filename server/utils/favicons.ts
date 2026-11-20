import { defineCachedFunction } from "nitro/cache"
import { parse } from "tldts"
import { FAVICON_PATH } from "#shared/resources"
import { siteTile } from "#shared/site-tile"

/**
 * A site's icon, fetched by Drop's server once per host and kept 30 days. Readers' browsers load it from Drop, so no
 * provider and no linked site learns who reads what, and every place Drop shows a link (a doc's chips and properties,
 * the dock, a folder's tiles) shows the same picture.
 *
 * Google's favicon service (the source comark-chips uses) knows the sites it has crawled; DuckDuckGo's fetches the site
 * when asked, so it finds a public preview deploy Google has never seen. Both are asked at once and Google's answer
 * wins. A host neither knows, such as a preview behind a sign-in (pr42.preview.example.com), takes the first domain
 * above it that has one, up to the site's own domain (example.com): a domain anyone can put sites under, such as
 * netlify.app, is a public suffix, so x.netlify.app never takes Netlify's logo. Without any, it's the site's letter
 * tile (#shared/site-tile).
 */

/** A host as a URL has it: lowercase labels, no port. */
export const FAVICON_HOST = /^(?=.{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)*$/

type Favicon = { type: string; body: string; missing?: true }
const MAX_BYTES = 64 * 1024
// Raster images only: an SVG served from Drop's origin could carry script.
const RASTER = new Set([
  "image/png",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/jpeg",
  "image/gif",
  "image/webp",
])
const DAY = 60 * 60 * 24

function base64(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** One host's own icon from the first provider that has it, or null when none does or none can be reached. */
async function ownIcon(host: string): Promise<Favicon | null> {
  const encoded = encodeURIComponent(host)
  const google = providerIcon(`https://www.google.com/s2/favicons?domain=${encoded}&sz=64`)
  const duckduckgo = providerIcon(`https://icons.duckduckgo.com/ip3/${encoded}.ico`)
  return (await google) ?? (await duckduckgo)
}

async function providerIcon(url: string): Promise<Favicon | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) })
    const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? ""
    if (!response.ok || !RASTER.has(type)) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.length && bytes.length <= MAX_BYTES ? { type, body: base64(bytes) } : null
  } catch {
    return null
  }
}

const PUBLIC_SUFFIXES = { allowPrivateDomains: true, detectSpecialUse: true }
const publicSite = (host: string) => {
  const site = parse(host, PUBLIC_SUFFIXES)
  return !site.isSpecialUse && (site.isIcann || site.isPrivate) ? site : null
}
const tileName = (host: string, site = publicSite(host)) => site?.domainWithoutSuffix || host

/**
 * The host, then each domain above it down to the site's own. A host that isn't under a public suffix (localhost, an
 * IP address, an intranet name) has no icon to ask for.
 */
function hostsOf(host: string, site: string | null | undefined) {
  if (!site) return []
  const labels = host.split(".")
  const depth = labels.length - site.split(".").length
  return labels.slice(0, depth + 1).map((_, start) => labels.slice(start).join("."))
}

export const siteIcon = defineCachedFunction(
  async (host: string): Promise<Favicon> => {
    const site = publicSite(host)
    for (const candidate of hostsOf(host, site?.domain)) {
      const icon = await ownIcon(candidate)
      if (icon) return icon
    }
    return { type: "image/svg+xml", body: btoa(siteTile(tileName(host, site))), missing: true }
  },
  {
    name: "favicons",
    maxAge: 30 * DAY,
    swr: true,
    getKey: (host: string) => host,
    // A host with no icon is asked again after a day, in case its site was down.
    validate: (entry) =>
      entry.value !== undefined && (!entry.value.missing || Date.now() - (entry.mtime ?? 0) < DAY * 1000),
  },
)

/** Point a rendered doc's icons at Drop and give the frame their fallback tile names without bundling the suffix list. */
export const absoluteFavicons = (html: string, origin: string) =>
  html.replace(
    new RegExp(`(\\s)src="(${FAVICON_PATH}([^"]*))"`, "g"),
    (_attribute, space: string, src: string, requested: string) => {
      const host = requested.toLowerCase().replace(/:\d{1,5}$/, "")
      const name = FAVICON_HOST.test(host) ? tileName(host) : null
      return `${space}src="${origin}${src}"${name ? ` data-drop-site="${name}"` : ""}`
    },
  )
