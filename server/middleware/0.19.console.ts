import { defineHandler, HTTPError, redirect } from "h3"

/**
 * Only admins see the ViteHub Console's pages. Anyone else signed in, agents too, gets a 404 as if Drop had none, and
 * a signed-out visit goes to /signin and back. Its files and data requests reach ViteHub untouched: console-authorize.ts
 * checks every data request, and an admin whose session ends with the Console open gets its "sign in" state from the
 * 401. So do ViteHub's other routes under /_vitehub, such as signed schedule dispatch. The content origin never serves
 * any of it (0.05).
 */
export default defineHandler(async (event) => {
  const path = event.url.pathname
  if (!/^\/_vitehub(?:\/|$)/.test(path) || /^\/_vitehub\/(?:assets|rpc)\//.test(path)) return
  if (event.req.method !== "GET" && event.req.method !== "HEAD") return
  const { identify } = await import("../utils/identity")
  const who = await identify(event)
  if (who?.role === "admin" && who.actorKind === "browser") return
  if (who) throw new HTTPError({ status: 404, statusText: "Not found" })
  // A browser opening the page, not a script or a tool fetching it.
  const mode = event.req.headers.get("sec-fetch-mode")
  if (mode ? mode === "navigate" : event.req.headers.get("accept")?.includes("text/html"))
    return redirect(`/signin?redirect=${encodeURIComponent(`${path}${event.url.search}`)}`, 302)
})
