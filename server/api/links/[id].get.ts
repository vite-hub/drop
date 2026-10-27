import { and, eq } from "drizzle-orm"
import { defineValidatedHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { type DropLink, slugify } from "#shared/links"
import { LinkQuerySchema } from "#shared/schemas"
import { dropVersions } from "../../databases/config"
import { expiredLink, findDrop, permissions, waitingForReview } from "../../utils/drops"
import { identify } from "../../utils/identity"
import { routeId } from "../../utils/params"

/**
 * Where a share link leads. `/d/<id>` opens the drop's latest version and `?v=<n>` pins one. The page then loads that
 * version from /api/drops/:id, which checks access again and says why a drop can't be opened.
 */
export default defineValidatedHandler({
  validate: { query: LinkQuerySchema },
  async handler(event): Promise<DropLink> {
    const id = await routeId(event)
    const pinned = Number(event.url.searchParams.get("v")) || undefined
    const [who, found, older] = await Promise.all([
      identify(event),
      findDrop(id, event),
      pinned
        ? db
            .select({ version: dropVersions.version })
            .from(dropVersions)
            .where(and(eq(dropVersions.dropId, id), eq(dropVersions.version, pinned)))
            .limit(1)
        : [],
    ])
    // Sharing belongs to the whole drop, so the drop answers for every version.
    if (!found || (!permissions(found, who).view && !waitingForReview(found, who) && !expiredLink(found, who)))
      throw new HTTPError({ status: 404, statusText: "This drop is private, or it was deleted." })
    if (pinned && pinned !== found.version && !older.length)
      throw new HTTPError({ status: 404, statusText: `This doc has no v${pinned}.` })
    event.res.headers.set("Cache-Control", "private, no-store")
    return {
      id: found.id,
      link: found.id,
      slug: found.slug ?? slugify(found.title),
      version: pinned ?? found.version,
      latest: found.version,
    }
  },
})
