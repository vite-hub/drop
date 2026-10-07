import { defineHandler } from "h3"

/**
 * On a VPS, a reverse proxy (Caddy, nginx) terminates HTTPS and talks plain HTTP to Node, and Nitro's Node server
 * ignores X-Forwarded-Proto. Without this, every URL Drop builds from the request (the GitHub callback, the OAuth
 * issuer, the MCP resource) would start with http://. Hosted platforms already see https, so it does nothing there.
 * Runs first: the request's URL is shared with `event.req`, which Better Auth reads.
 */
export default defineHandler((event) => {
  if (event.url.protocol === "http:" && event.req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https")
    event.url.protocol = "https:"
})
