import { createError } from "evlog"
import { defineHandler } from "h3"
import { blob } from "vite-hub/blob"

export default defineHandler(async (event) => {
  event.res.headers.set("Cache-Control", "public, max-age=300")
  let uploads = 0
  let cursor: string | undefined

  do {
    const [error, page] = await blob.list({ cursor, limit: 1_000 })
    if (error) {
      throw createError({
        cause: error,
        code: "DROP_FILE_STATS_FAILED",
        message: "File statistics are temporarily unavailable.",
        status: 503,
      })
    }
    uploads += page.blobs.length
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)

  return uploads
})
