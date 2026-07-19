import { defineHandler, setResponseHeaders } from "h3"
import { blob } from "vite-hub/blob"

export default defineHandler(async (event) => {
  setResponseHeaders(event, { "Cache-Control": "public, max-age=300" })
  return { uploads: await countImages() }
})

async function countImages() {
  let uploads = 0
  let cursor: string | undefined

  do {
    const page = await blob.list({ cursor, limit: 1_000 })
    uploads += page.blobs.length
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)

  return uploads
}
