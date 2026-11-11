import { defineHandler, HTTPError, HTTPResponse, redirect } from "h3"
import { AI_FETCHER } from "../utils/ai-fetcher"

const notFound = () => new HTTPError({ status: 404, statusText: "Not found" })

/** A path segment as written, or a 404 when its percent-encoding is malformed (decodeURIComponent throws). */
function decoded(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw notFound()
  }
}

/** Gates file URLs and shared pages before rendering; all utility imports stay out of the Worker entry. */
export default defineHandler(async (event) => {
  if (event.url.pathname.startsWith("/f/")) {
    const key = decoded(event.url.pathname.slice(3))
    if (event.url.searchParams.has("raw") || /\.(html?|shtml|xht(?:ml)?|svgz?)$/i.test(key))
      event.res.headers.set("Content-Security-Policy", "sandbox")
    const { requireBlobAccess } = await import("../utils/content-access")
    await requireBlobAccess(event, key)
    event.context.dropAccessChecked = true
    return
  }
  // `/d/<link>`, the address the page settles on, `/d/<link>/<slug>`, and a page of an app under it,
  // `/d/<link>/<slug>/guide/setup`.
  const page = event.url.pathname.match(/^\/d\/([^/]+)(?:\/[^/]*(\/.*)?)?$/)
  if (!page) return
  const [{ expiredLink, findDrop, permissions, waitingForReview }, { identify }] = await Promise.all([
    import("../utils/drops"),
    import("../utils/identity"),
  ])
  const [drop, who] = await Promise.all([findDrop(decoded(page[1]!), event), identify(event)])
  if (waitingForReview(drop, who))
    throw new HTTPError({ status: 403, statusText: "Waiting for review", data: { shareReview: "pending" } })
  if (expiredLink(drop, who)) throw new HTTPError({ status: 410, statusText: "Expired" })
  if (!drop || !permissions(drop, who).view) {
    const headers = event.req.headers
    if (
      ["GET", "HEAD"].includes(event.req.method) &&
      (AI_FETCHER.test(headers.get("user-agent") ?? "") || !/\btext\/html\b/i.test(headers.get("accept") ?? ""))
    )
      // Missing and inaccessible drops give the same hint, so it cannot disclose a private drop.
      return new Response(
        event.req.method === "HEAD"
          ? null
          : `Not found or sign-in required. Connect to ${event.url.origin}/mcp, sign in with your Drop account, and use the read_drop MCP tool with this link.\n`,
        {
          status: 404,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "private, no-store",
            Vary: "Accept, User-Agent",
            "X-Content-Type-Options": "nosniff",
            "X-Robots-Tag": "noindex, nofollow",
          },
        },
      )
    throw notFound()
  }
  event.res.headers.set("Cache-Control", "private, no-store")
  const { dropPath, slugify } = await import("../../shared/links")
  const to = dropPath({ link: drop.id, slug: drop.slug ?? slugify(drop.title) })
  // A path under the link is a page of the app: the link opens it as `?path=`, where the viewer keeps an app's address
  // (useAppFiles). The query keys Drop's page reads stay its own, and the rest go with the path to the app. The browser
  // keeps the #hash across the redirect. A doc has no pages, so the path goes.
  if (page[2]) {
    if (!["GET", "HEAD"].includes(event.req.method)) throw notFound()
    const { DROP_PAGE_PARAMS } = await import("../../shared/links")
    const ours = new URLSearchParams()
    const app = new URLSearchParams()
    for (const [key, value] of event.url.searchParams)
      if (key !== "path" && key !== "file") (DROP_PAGE_PARAMS.includes(key) ? ours : app).append(key, value)
    if (drop.kind === "app") ours.set("path", `${page[2]}${app.size ? `?${app}` : ""}`)
    return redirect(`${to}${ours.size ? `?${ours}` : ""}`)
  }
  // A pinned `?v=` renders: the page checks that the version exists.
  if (!["GET", "HEAD"].includes(event.req.method) || event.url.searchParams.has("v")) return
  // The page moves to the doc's own address (pages/d/[id]/[[slug]].vue). Redirecting here saves rendering a page only
  // to send that redirect, as `/d/<link>` without its slug did.
  if (event.url.pathname !== to) return redirect(to + event.url.search)
  // HEAD wants the status, not the page (a full render, ~0.9 s).
  if (event.req.method === "HEAD")
    return new HTTPResponse(null, { headers: { "content-type": "text/html;charset=utf-8" } })
})
