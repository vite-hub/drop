import { blob } from "vite-hub/blob"
import { lte } from "drizzle-orm"
import { db } from "vite-hub/database/drizzle"
import { codeImages } from "../databases/config"
import { defineSchedule } from "vite-hub/schedule"
import { cleanupQuotaBlobs, releaseQuotaBlobs } from "../utils/quotas"
import { CODE_IMAGE_PREFIX, isExpiredCodeImage } from "../utils/code-image"

export default defineSchedule({
  cron: "0 * * * *",
  async handler({ scheduledAt }) {
    await cleanupQuotaBlobs(scheduledAt)
    await db.delete(codeImages).where(lte(codeImages.expiresAt, scheduledAt.getTime()))
    const { cleanupUnusedOAuthClients } = await import("../utils/oauth-cleanup")
    await cleanupUnusedOAuthClients(scheduledAt)
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
  },
})
