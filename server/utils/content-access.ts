import { eq } from "drizzle-orm"
import { HTTPError, type H3Event } from "h3"
import { blob } from "vite-hub/blob"
import { db } from "vite-hub/database/drizzle"
import { blobTombstones, codeImages, user } from "../databases/config"
import { findDropByBlob, permissions } from "./drops"
import { identify } from "./identity"
import { isExpiredCodeImage } from "./code-image"

// The account rebuild landed on 2026-10-07. New orphaned blobs must never become anonymous uploads.
export const LEGACY_UPLOAD_CUTOFF = Date.parse("2026-10-07T11:48:03Z")
const notFound = () => new HTTPError({ status: 404, statusText: "Not found" })

/** One owner join for managed files. Only genuinely old anonymous uploads need a storage HEAD. */
export async function requireBlobAccess(event: H3Event, key: string) {
  // Shared content must be rechecked after a ban or deletion, including raw downloads and images.
  event.res.headers.set("Cache-Control", "private, no-store")
  if (key.startsWith("apps/")) throw notFound()
  if (key.startsWith("code-images/")) {
    if (isExpiredCodeImage(key, new Date())) throw notFound()
    const [image] = await db.select({ ownerId: user.id, banned: user.banned }).from(codeImages)
      .leftJoin(user, eq(user.id, codeImages.ownerId)).where(eq(codeImages.blobKey, key)).limit(1)
    if (!image?.ownerId || image.banned) throw notFound()
    return
  }

  const drop = await findDropByBlob(key)
  if (drop) {
    if (drop.ownerBanned) throw notFound()
    if (drop.visibility !== "shared" && !permissions(drop, await identify(event)).view) throw notFound()
    return
  }

  const [tombstone] = await db.select({ key: blobTombstones.blobKey }).from(blobTombstones).where(eq(blobTombstones.blobKey, key)).limit(1)
  if (tombstone) throw notFound()
  const [error, object] = await blob.head(key)
  if (error) throw new HTTPError({ status: 503, statusText: "File storage is temporarily unavailable." })
  const uploaded = object?.uploadedAt?.getTime()
  if (!uploaded || uploaded >= LEGACY_UPLOAD_CUTOFF) throw notFound()
}
