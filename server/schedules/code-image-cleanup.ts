import { createError, createLogger } from "evlog"

import { CODE_IMAGE_PREFIX, isExpiredCodeImage } from "../utils/code-images"

export default defineSchedule({
  cron: "0 * * * *",
  async handler({ scheduledAt }) {
    const log = createLogger({
      operation: "code-image-cleanup",
      schedule: { scheduledAt: scheduledAt.toISOString() },
    })
    let cursor: string | undefined
    let deleted = 0

    try {
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
          deleted += expired.length
        }

        cursor = result.cursor
      } while (cursor)

      log.set({ cleanup: { deleted } })
    }
    catch (error) {
      const failure = createError({
        cause: error instanceof Error ? error : undefined,
        code: "DROP_CODE_IMAGE_CLEANUP_FAILED",
        message: "Code image cleanup failed.",
      })
      log.error(failure)
      throw failure
    }
    finally {
      log.emit()
    }
  },
})
