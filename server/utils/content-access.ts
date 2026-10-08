import { eq } from "drizzle-orm"
import { HTTPError, type H3Event } from "h3"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
import { blobTombstones, codeImages, user } from "../databases/config"
import { findDropByBlob, permissions } from "./drops"
import { identify } from "./identity"
import { isExpiredCodeImage } from "./code-image"
import { rawFileQuarantine, rawFileQuarantined } from "./trust"

// The account rebuild landed on 2026-10-07. New orphaned blobs must never become anonymous uploads.
export const LEGACY_UPLOAD_CUTOFF = Date.parse("2026-10-07T12:59:35Z")
const notFound = () => new HTTPError({ status: 404, statusText: "Not found" })

/** One owner join for managed files. Only genuinely old anonymous uploads need a storage HEAD. */
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
  if (drop) {
    if (drop.ownerBanned || drop.quarantinedAt) throw notFound()
    if (!permissions(drop, null).view && !permissions(drop, await identify(event)).view) throw notFound()
    return
  }

  if (await rawFileQuarantined(event.url.pathname)) throw notFound()
  const [tombstone] = await db.select({ key: blobTombstones.blobKey }).from(blobTombstones).where(eq(blobTombstones.blobKey, key)).limit(1)
  if (tombstone) throw notFound()
  const [error, object] = await blob.head(key)
  if (error?.code === "BLOB_NOT_FOUND") throw notFound()
  if (error) throw new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable." })
  if (!object) throw notFound()
  const uploaded = object?.uploadedAt?.getTime()
  if (!uploaded || uploaded >= LEGACY_UPLOAD_CUTOFF) throw notFound()
}
