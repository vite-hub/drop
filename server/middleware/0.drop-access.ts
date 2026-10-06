import { eq } from "drizzle-orm"
import { defineHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { drops } from "../databases/config"
import { permissions } from "../utils/drops"
import { identify } from "../utils/identity"

/**
 * Gates `/f/<key>` before the blob route and the document renderer run.
 * Private drops answer 404 to anyone who can't see them, so the URL doesn't reveal that the file exists.
 * Uploads from before accounts have no drop row and stay public; so do expiring code images.
 */
export default defineHandler(async (event) => {
  if (!["GET", "HEAD"].includes(event.req.method) || !event.url.pathname.startsWith("/f/")) return
  const key = decodeURIComponent(event.url.pathname.slice(3))
  if (key.startsWith("apps/")) throw new HTTPError({ status: 404, statusText: "Not found" })
  if (key.startsWith("code-images/")) return

  const [drop] = await db.select().from(drops).where(eq(drops.blobKey, key)).limit(1)
  if (!drop) return
  if (drop.visibility === "shared") return
  if (!permissions(drop, await identify(event)).view) throw new HTTPError({ status: 404, statusText: "Not found" })
  event.context.dropPrivate = true
  event.res.headers.set("Cache-Control", "private, no-store")
})
