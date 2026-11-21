import { defineHandler, HTTPError } from "h3"
import { FAVICON_HOST, siteIcon } from "../../utils/favicons"

export default defineHandler(async (event) => {
  const host = decodeURIComponent(event.context.params?.host ?? "")
    .toLowerCase()
    .replace(/:\d{1,5}$/, "")
  if (!FAVICON_HOST.test(host)) throw new HTTPError({ status: 400, statusText: "Not a host name." })
  const icon = await siteIcon(host)
  const bytes = Uint8Array.from(atob(icon.body), (char) => char.charCodeAt(0))
  return new Response(bytes, {
    headers: {
      "Content-Type": icon.type,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  })
})
