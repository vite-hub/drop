import { defineCachedFunction } from "nitro/cache"
import { parse } from "tldts"
import { FAVICON_PATH } from "#shared/resources"
import { siteTile } from "#shared/site-tile"

export const FAVICON_HOST = /^(?=.{1,253}$)[a-z0-9-]+(?:\.[a-z0-9-]+)*$/

type Favicon = { type: string; body: string; missing?: true }
const MAX_BYTES = 64 * 1024
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
    validate: (entry) =>
      entry.value !== undefined && (!entry.value.missing || Date.now() - (entry.mtime ?? 0) < DAY * 1000),
  },
)

export const absoluteFavicons = (html: string, origin: string) =>
  html.replace(
    new RegExp(`(\\s)src="(${FAVICON_PATH}([^"]*))"`, "g"),
    (_attribute, space: string, src: string, requested: string) => {
      const host = requested.toLowerCase().replace(/:\d{1,5}$/, "")
      const name = FAVICON_HOST.test(host) ? tileName(host) : null
      return `${space}src="${origin}${src}"${name ? ` data-drop-site="${name}"` : ""}`
    },
  )
