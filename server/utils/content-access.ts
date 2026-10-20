import { eq } from "drizzle-orm"
import { HTTPError, type H3Event } from "h3"
import { db } from "vite-hub/database/drizzle"
import { codeImages, user } from "../databases/config"
import { findDropByBlob, permissions } from "./drops"
import { identify } from "./identity"
import { isExpiredCodeImage } from "./code-image"
import { recordVisit } from "./expiry"
import { rawFileQuarantine } from "./trust"
import { countView } from "./views"

const notFound = () => new HTTPError({ status: 404, statusText: "Not found" })

/** One owner join per file. A blob without a drop or a code image behind it is never served. */
export async function requireBlobAccess(event: H3Event, key: string) {
  // Shared content must be rechecked after a ban or deletion, including raw downloads and images.
  event.res.headers.set("Cache-Control", "private, no-store")
  // App files are served from the app's own origin; live drafts only through their Realtime room.
  if (key.startsWith("apps/") || key.startsWith("drafts/")) throw notFound()
  if (key.startsWith("code-images/")) {
    if (isExpiredCodeImage(key, new Date())) throw notFound()
    const [image] = await db
      .select({ ownerId: user.id, banned: user.banned, quarantined: rawFileQuarantine(event.url.pathname) })
      .from(codeImages)
      .leftJoin(user, eq(user.id, codeImages.ownerId))
      .where(eq(codeImages.blobKey, key))
      .limit(1)
    if (!image?.ownerId || image.banned || image.quarantined) throw notFound()
    return
  }

  const drop = await findDropByBlob(key, event)
  if (!drop || drop.ownerBanned || drop.quarantinedAt) throw notFound()
  const publicView = permissions(drop, null).view
  const who = publicView ? null : await identify(event)
  if (!publicView && !permissions(drop, who).view) throw notFound()
  // Opening a raw file in the browser is a visit; images embedded elsewhere are not.
  await Promise.all([recordVisit(event, drop, who, "document"), countView(event, drop, who, "document")])
}
