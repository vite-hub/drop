import { HTTPError } from "h3"
import { defineCachedHandler } from "nitro/cache"
import { blob } from "vite-hub/blob"

/**
 * How many files Drop holds. Public and the same for everyone, so Nitro caches it for five minutes in the
 * Worker's KV (nitro `cache` storage) instead of paging through the bucket on every landing-page view.
 */
export default defineCachedHandler(async () => {
  let uploads = 0
  let cursor: string | undefined
  do {
    const [error, page] = await blob.list({ cursor, limit: 1_000 })
    if (error) throw new HTTPError({ status: 503, statusText: "File statistics are temporarily unavailable." })
    uploads += page.blobs.length
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return uploads
}, { name: "stats", maxAge: 300, swr: true })
