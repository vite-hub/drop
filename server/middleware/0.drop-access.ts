import { eq } from "drizzle-orm"
import { defineHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { drops } from "../databases/config"

/**
 * Gates `/f/<key>` before the blob route and the document renderer run.
 * Private drops answer 404 to anyone who can't see them, so the URL doesn't reveal that the file exists.
 * Uploads from before accounts have no drop row and stay public; so do expiring code images.
 */
export default defineHandler(async (event) => {
  if (!["GET", "HEAD"].includes(event.req.method) || !event.url.pathname.startsWith("/f/")) return
  const key = decodeURIComponent(event.url.pathname.slice(3))
  if (key.startsWith("apps/")) throw new HTTPError({ status: 404, statusText: "Not found" })
  if (event.url.searchParams.has("raw") || /\.(html?|shtml|xht(?:ml)?|svgz?)$/i.test(key)) {
    event.res.headers.set("Content-Security-Policy", "sandbox")
  }
  if (key.startsWith("code-images/")) {
    const { isExpiredCodeImage } = await import("../utils/code-image")
    if (isExpiredCodeImage(key, new Date())) throw new HTTPError({ status: 404, statusText: "Not found" })
    return
  }

  const [drop] = await db.select().from(drops).where(eq(drops.blobKey, key)).limit(1)
  if (!drop) return
  if (drop.visibility === "shared") return
  event.res.headers.set("Cache-Control", "private, no-store")
  // Loaded lazily: middleware lands in the Worker's entry module, and anything it imports statically would be
  // re-exported from there, which Workers rejects as extra entrypoints.
  const [{ permissions }, { identify }] = await Promise.all([import("../utils/drops"), import("../utils/identity")])
  if (!permissions(drop, await identify(event)).view) throw new HTTPError({ status: 404, statusText: "Not found" })
  event.context.dropPrivate = true
})
