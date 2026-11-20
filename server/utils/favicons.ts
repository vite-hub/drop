import { defineCachedFunction } from "nitro/cache"
import { getDomain, getDomainWithoutSuffix } from "tldts"
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

/** Each provider's address for a host's icon. Both answer a host they don't know with a 404 and a placeholder. */
const PROVIDERS = [
  (host: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
  (host: string) => `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
]

/** One host's own icon from the first provider that has it, or null when none does or none can be reached. */
async function ownIcon(host: string): Promise<Favicon | null> {
  const found = await Promise.all(PROVIDERS.map((provider) => providerIcon(provider(host))))
  return found.find((icon) => icon !== null) ?? null
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

const PUBLIC_SUFFIXES = { allowPrivateDomains: true }

/**
 * The host, then each domain above it down to the site's own. A host that isn't under a public suffix (localhost, an
 * IP address, an intranet name) has no icon to ask for.
 */
function hostsOf(host: string) {
  const site = getDomain(host, PUBLIC_SUFFIXES)
  if (!site) return []
  const labels = host.split(".")
  const depth = labels.length - site.split(".").length
  return labels.slice(0, depth + 1).map((_, start) => labels.slice(start).join("."))
}

/** The site's letter tile: github for gist.github.com, acme for acme.netlify.app, the host itself without a site. */
function tile(host: string): Favicon {
  const name = getDomainWithoutSuffix(host, PUBLIC_SUFFIXES) || host
  return { type: "image/svg+xml", body: btoa(siteTile(name)), missing: true }
}

export const siteIcon = defineCachedFunction(
  async (host: string): Promise<Favicon> => {
    for (const candidate of hostsOf(host)) {
      const icon = await ownIcon(candidate)
      if (icon) return icon
    }
    return tile(host)
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

/** A rendered doc's icons, which render with Drop-relative addresses, pointed at Drop's origin for the viewer's frame. */
export const absoluteFavicons = (html: string, origin: string) =>
  html.replaceAll(`src="${FAVICON_PATH}`, `src="${origin}${FAVICON_PATH}`)
