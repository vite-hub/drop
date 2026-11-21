import { and, eq } from "drizzle-orm"
import { defineValidatedHandler, HTTPError } from "h3"
import { db } from "vite-hub/database"
import { type DropLink, slugify } from "#shared/links"
import { LinkQuerySchema } from "#shared/schemas"
import { dropVersions } from "../../databases/default/index"
import { expiredLink, findDrop, permissions, waitingForReview } from "../../utils/drops"
import { identify } from "../../utils/identity"
import { routeId } from "../../utils/params"

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
