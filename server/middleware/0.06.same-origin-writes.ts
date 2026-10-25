import { defineHandler, HTTPError } from "h3"

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Browser writes that carry Drop's cookies must come from Drop's own pages. A sibling subdomain (the content
 * origin, for one) is same-site, so SameSite=Lax still sends the session; a no-preflight request like a text/plain
 * POST would reach the API as the viewer. Agents use bearer tokens and send no cookies, so they're unaffected.
 */
export default defineHandler((event) => {
  const path = event.url.pathname
  if (
    SAFE_METHODS.has(event.req.method) ||
    !(path.startsWith("/api/") || path === "/_vitehub" || path.startsWith("/_vitehub/")) ||
    !event.req.headers.has("cookie")
  )
    return
  const site = event.req.headers.get("sec-fetch-site")
  const origin = event.req.headers.get("origin")
  if ((site && site !== "same-origin" && site !== "none") || (origin && origin !== event.url.origin))
    throw new HTTPError({ status: 403, statusText: "Cross-origin request blocked." })
})
