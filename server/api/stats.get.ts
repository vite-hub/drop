import { defineHandler, HTTPError } from "h3"
import { blob } from "vite-hub/blob"

export default defineHandler(async (event) => {
  event.res.headers.set("Cache-Control", "public, max-age=300")
  let uploads = 0
  let cursor: string | undefined

  do {
    const [error, page] = await blob.list({ cursor, limit: 1_000 })
    if (error) throw new HTTPError({ status: 503, statusText: "File statistics are temporarily unavailable." })
    uploads += page.blobs.length
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)

  return uploads
})
