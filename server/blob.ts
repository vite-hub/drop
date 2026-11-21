import { HTTPError } from "h3"
import type { BlobServeAnonymousAuthorize } from "vite-hub/blob"

function servedKey(pathname: string) {
  let key = pathname
  try {
    key = decodeURIComponent(pathname)
  } catch {}
  return key.replace(/^\/+/, "")
}

export const authorize: BlobServeAnonymousAuthorize = async ({ event }) => {
  const pathname = event.context.params?._
  if (!pathname) throw new HTTPError({ status: 404, statusText: "Not found" })
  const { requireBlobAccess } = await import("./utils/content-access")
  await requireBlobAccess(event, servedKey(pathname))
  return true
}
