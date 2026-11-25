import { eq } from "drizzle-orm"
import { HTTPError, type H3Event } from "h3"
import { db } from "vite-hub/database"
import { codeImages, user } from "../databases/default/index"
import { findDropByBlob, permissions } from "./drops"
import { identify } from "./identity"
import { isExpiredCodeImage } from "./code-image"
import { recordVisit } from "./expiry"
import { rawFileQuarantine } from "./trust"
import { countView } from "./views"

const notFound = () => new HTTPError({ status: 404, statusText: "Not found" })

export async function requireBlobAccess(event: H3Event, key: string) {
  event.res.headers.set("Cache-Control", "private, no-store")
  if (key.startsWith("apps/") || key.startsWith("drafts/")) throw notFound()
  if (key.startsWith("code-images/")) {
    if (isExpiredCodeImage(key, new Date())) throw notFound()
    const [image] = await db
      .select({ ownerId: user.id, banned: user.banned, quarantined: rawFileQuarantine(key).mapWith(Boolean) })
      .from(codeImages)
      .leftJoin(user, eq(user.id, codeImages.ownerId))
      .where(eq(codeImages.blobKey, key))
      .limit(1)
    if (!image?.ownerId || image.banned || image.quarantined) throw notFound()
    return
  }

  const [drop, caller] = await Promise.all([findDropByBlob(key, event), identify(event)])
  if (!drop || drop.ownerBanned || drop.quarantinedAt) throw notFound()
  const publicView = permissions(drop, null).view
  const who = publicView ? null : caller
  if (!publicView && !permissions(drop, who).view) throw notFound()
  await Promise.all([recordVisit(event, drop, who, "document"), countView(event, drop, who, "document")])
}
