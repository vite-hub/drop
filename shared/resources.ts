// A drop's resources: links it points to, like the pull request it documents and that PR's preview. They show with
// their sites' icons at the top of the drop's page. Agents set them when they publish (server/utils/resources.ts).
import { isLocal } from "./review"
import type { DropResource } from "./types"

export const MAX_RESOURCES = 8
export const MAX_RESOURCE_URL = 2000
export const MAX_RESOURCE_TITLE = 100

/** What a resource may link to: https, or http on this computer. Normalized, so one page is one resource. */
export function resourceUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.username || parsed.password) return null
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal(parsed.hostname))) return null
  return parsed.href
}

/** Its title, or the host it's on without `www.`. */
export const resourceLabel = (resource: DropResource) =>
  resource.title || new URL(resource.url).hostname.replace(/^www\./, "")

/**
 * Where its site's icon may be: `/favicon.ico` on its host, then on each domain above it, down to two labels. A
 * favicon belongs to the site, not the page, so a private repository's pull request still gets GitHub's, and a
 * preview behind a sign-in (pr123.preview.example.com) falls back to its company's (example.com).
 */
export function faviconUrls(url: string): string[] {
  const { origin, hostname } = new URL(url)
  const urls = [`${origin}/favicon.ico`]
  if (isLocal(hostname) || /^[\d.]+$|^\[/.test(hostname)) return urls
  const labels = hostname.split(".")
  for (let start = 1; labels.length - start >= 2; start++)
    urls.push(`https://${labels.slice(start).join(".")}/favicon.ico`)
  return urls
}

/** `next` added to `current`: a link already there keeps its place and takes the new title, if it has one. */
export function mergeResources(current: DropResource[], next: DropResource[]): DropResource[] {
  const merged = current.map((resource) => ({ ...resource }))
  for (const resource of next) {
    const same = merged.find((item) => item.url === resource.url)
    if (!same) merged.push(resource)
    else if (resource.title) same.title = resource.title
  }
  return merged
}
