export default defineSchedule({
  cron: "0 * * * *",
  async handler({ scheduledAt }) {
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
      }

      cursor = result.cursor
    } while (cursor)
  },
})
