import { isLocal } from "./review"
import type { DropResource } from "./types"

export const MAX_RESOURCES = 8
export const MAX_RESOURCE_URL = 2000
export const MAX_RESOURCE_TITLE = 100

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

const REFERENCE =
  /^https:\/\/(?:www\.)?(?:github\.com|gitlab\.com)\/([\w.-]+\/[\w.-]+)\/(?:-\/)?(?:pull|issues|merge_requests)\/(\d+)\/?(?:[?#].*)?$/

export function resourceLabel(resource: DropResource) {
  if (resource.title) return resource.title
  const reference = REFERENCE.exec(resource.url)
  return reference ? `${reference[1]}#${reference[2]}` : new URL(resource.url).hostname.replace(/^www\./, "")
}

export const FAVICON_PATH = "/api/favicons/"

export const faviconUrl = (url: string, origin = "") => `${origin}${FAVICON_PATH}${new URL(url).hostname}`

export function mergeResources(current: DropResource[], next: DropResource[]): DropResource[] {
  const merged = current.map((resource) => ({ ...resource }))
  for (const resource of next) {
    const same = merged.find((item) => item.url === resource.url)
    if (!same) merged.push(resource)
    else if (resource.title) same.title = resource.title
  }
  return merged
}

export function pullRequestOf(url: string): { repo: string; number: number } | null {
  const { hostname, pathname } = new URL(url)
  const match = hostname === "github.com" ? pathname.match(/^\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:\/|$)/) : null
  return match ? { repo: match[1]!, number: Number(match[2]) } : null
}

export function linkSource(url: string) {
  const pull = pullRequestOf(url)
  return pull ? `${pull.repo}#${pull.number}` : new URL(url).hostname.replace(/^www\./, "")
}

export function linkText(resource: DropResource) {
  if (resource.title) return resource.title
  const reference = REFERENCE.exec(resource.url)
  if (reference) return `${reference[1]}#${reference[2]}`
  const url = new URL(resource.url)
  return `${url.host.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`
}
