import { defineValidatedHandler, HTTPError } from "h3"
import { type DropLink, slugify } from "#shared/links"
import { LinkQuerySchema } from "#shared/schemas"
import { expiredLink, findDrop, permissions, versionChain, waitingForReview } from "../../utils/drops"
import { identify } from "../../utils/identity"
import { routeId } from "../../utils/params"

/**
 * Where a share link leads. `/d/<link>` opens the doc's latest version and `?v=<n>` pins one. A link from before docs
 * had one (`/d/<version id>`) opens the latest version too, and says which one it pointed at (`from`). The page then
 * loads that version from /api/drops/:id, which checks access again and says why a drop can't be opened.
 */
export default defineValidatedHandler({
  validate: { query: LinkQuerySchema },
  async handler(event): Promise<DropLink> {
    const key = await routeId(event)
    const pinned = Number(event.url.searchParams.get("v")) || undefined
    const who = await identify(event)
    const found = await findDrop(key, event)
    // Sharing belongs to the whole doc, so the version that was found answers for all of them.
    if (!found || (!permissions(found, who).view && !waitingForReview(found, who) && !expiredLink(found, who)))
      throw new HTTPError({ status: 404, statusText: "This drop is private, or it was deleted." })
    const chain = await versionChain(found)
    const head = chain[0]!
    const target = pinned ? chain.find((row) => row.version === pinned) : head
    if (!target) throw new HTTPError({ status: 404, statusText: `This doc has no v${pinned}.` })
    const from = key === found.id && found.id !== head.id && !pinned ? { from: found.version } : {}
    event.res.headers.set("Cache-Control", "private, no-store")
    return {
      id: target.id,
      link: head.link ?? head.id,
      slug: head.slug ?? slugify(head.title),
      version: target.version,
      latest: head.version,
      ...from,
    }
  },
})
