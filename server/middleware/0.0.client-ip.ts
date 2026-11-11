import { defineHandler } from "h3"
import { useRuntimeConfig } from "nitro/runtime-config"
import { CLIENT_IP_HEADERS } from "#shared/client-ip"

/** Better Auth reads headers; srvx exposes Deno's native remoteAddr as req.ip. Never accept an inbound copy. */
export default defineHandler((event) => {
  if (useRuntimeConfig().clientIpHeader !== CLIENT_IP_HEADERS.deno) return
  // Deno.serve supplies immutable headers. Replace the exposed headers without consuming the body or losing runtime info.
  const headers = new Headers(event.req.headers)
  headers.delete(CLIENT_IP_HEADERS.deno)
  if (event.req.ip) headers.set(CLIENT_IP_HEADERS.deno, event.req.ip)
  Object.defineProperty(event.req, "headers", { value: headers, configurable: true })
})
