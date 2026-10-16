import { blob } from "vite-hub/blob"
import { lte } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { codeImages } from "../databases/config"
import { defineSchedule } from "vite-hub/schedule"
import { cleanupQuotaBlobs, cleanupQuotaReservations, releaseQuotaBlobs } from "../utils/quotas"
import { CODE_IMAGE_PREFIX, isExpiredCodeImage } from "../utils/code-image"

export default defineSchedule({
  cron: "0 * * * *",
  async handler({ scheduledAt }) {
    // Each step runs even when another fails, so a storage hiccup doesn't hold back the Trash purge.
    const errors: unknown[] = []
    const steps: Array<() => Promise<unknown>> = [
      () => cleanupQuotaReservations(scheduledAt),
      // Code-image rows go only once their blobs are gone and their bytes released.
      async () => {
        await cleanupQuotaBlobs(scheduledAt)
        await db.delete(codeImages).where(lte(codeImages.expiresAt, scheduledAt.getTime()))
      },
      async () => (await import("../utils/drops")).deleteExpiredDrops(scheduledAt),
      async () => (await import("../utils/oauth-cleanup")).cleanupUnusedOAuthClients(scheduledAt),
      () => deleteExpiredCodeImages(scheduledAt),
    ]
    for (const step of steps) await step().catch(error => errors.push(error))
    if (errors.length === 1) throw errors[0]
    if (errors.length) throw new AggregateError(errors, errors.map(error => (error instanceof Error ? error.message : String(error))).join("; "))
  },
})

/** Code-image blobs past the expiry written in their name. */
async function deleteExpiredCodeImages(scheduledAt: Date) {
  let cursor: string | undefined

  do {
    const [listError, result] = await blob.list({
      cursor,
      prefix: CODE_IMAGE_PREFIX,
    })
    if (listError)
      throw listError

    const expired = result.blobs
      .map(image => image.pathname)
      .filter(pathname => isExpiredCodeImage(pathname, scheduledAt))

    if (expired.length > 0) {
      const [deleteError] = await blob.del(expired)
      if (deleteError)
        throw deleteError
      await releaseQuotaBlobs(expired)
    }

    cursor = result.cursor
  } while (cursor)
}
