import { eq } from "drizzle-orm"
import { HTTPError, type H3Event } from "h3"
import { db } from "vite-hub/database/drizzle"
import { codeImages, user } from "../databases/config"
import { findDropByBlob, permissions } from "./drops"
import { identify } from "./identity"
import { isExpiredCodeImage } from "./code-image"
import { rawFileQuarantine } from "./trust"

const notFound = () => new HTTPError({ status: 404, statusText: "Not found" })

/** One owner join per file. A blob without a drop or a code image behind it is never served. */
export async function requireBlobAccess(event: H3Event, key: string) {
  // Shared content must be rechecked after a ban or deletion, including raw downloads and images.
  event.res.headers.set("Cache-Control", "private, no-store")
  if (key.startsWith("apps/")) throw notFound()
  if (key.startsWith("code-images/")) {
    if (isExpiredCodeImage(key, new Date())) throw notFound()
    const [image] = await db.select({ ownerId: user.id, banned: user.banned, quarantined: rawFileQuarantine(event.url.pathname) }).from(codeImages)
      .leftJoin(user, eq(user.id, codeImages.ownerId)).where(eq(codeImages.blobKey, key)).limit(1)
    if (!image?.ownerId || image.banned || image.quarantined) throw notFound()
    return
  }

  const drop = await findDropByBlob(key, event)
  if (!drop || drop.ownerBanned || drop.quarantinedAt) throw notFound()
  if (!permissions(drop, null).view && !permissions(drop, await identify(event)).view) throw notFound()
}
