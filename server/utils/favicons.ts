import { defineCachedFunction } from "nitro/cache"
import { FAVICON_PATH } from "#shared/resources"

/**
 * A site's icon, from the source comark-chips uses for a link (Google's favicon service, at 64px), fetched by Drop's
 * server once per host and kept 30 days. Readers' browsers load it from Drop, so neither Google nor the linked site
 * learns who reads what, and every place Drop shows a link (a doc's chips and properties, the dock, a folder's tiles,
 * review.js) shows the same picture. A host with no icon of its own, such as a preview behind a sign-in
 * (pr42.preview.example.com), takes the first domain above it that has one (example.com), and else a link icon.
 */

/** A host as a URL has it: lowercase labels, no port. */
export const FAVICON_HOST = /^(?=.{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)*$/

// Lucide's link, in a neutral grey that reads on light and dark.
const LINK_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#737373" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'

type Favicon = { type: string; body: string; missing?: true }
const FALLBACK: Favicon = { type: "image/svg+xml", body: btoa(LINK_ICON), missing: true }
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

/** One host's own icon, or null when Google has none for it (a 404 with a generic globe) or can't be reached. */
async function ownIcon(host: string): Promise<Favicon | null> {
  try {
    const response = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`, {
      signal: AbortSignal.timeout(4000),
    })
    const type = response.headers.get("content-type")?.split(";")[0]?.trim() ?? ""
    if (!response.ok || !RASTER.has(type)) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.length && bytes.length <= MAX_BYTES ? { type, body: base64(bytes) } : null
  } catch {
    return null
  }
}

/** The host, then each domain above it down to two labels. A name without a dot, or an IP address, is only itself. */
function hostsOf(host: string) {
  if (!host.includes(".") || /^[\d.]+$/.test(host)) return []
  const labels = host.split(".")
  return labels.slice(0, -1).map((_, start) => labels.slice(start).join("."))
}

export const siteIcon = defineCachedFunction(
  async (host: string): Promise<Favicon> => {
    for (const candidate of hostsOf(host)) {
      const icon = await ownIcon(candidate)
      if (icon) return icon
    }
    return FALLBACK
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
