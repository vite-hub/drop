import { eq, inArray } from "drizzle-orm"
import { defineValidatedHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { DropPatchSchema } from "#shared/schemas"
import { drops } from "../../databases/config"
import { findDrop, permissions, toSummary, versionChain } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"
import { shareReviewFor } from "../../utils/trust"
import { routeId } from "../../utils/params"

/** Share, unshare, change the link's access level, or rename. */
export default defineValidatedHandler({
  validate: { body: DropPatchSchema },
  async handler(event) {
    const who = await requireIdentity(event)
    const drop = await findDrop(await routeId(event), event)
    if (!drop || !permissions(drop, who).manage) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
    const body = await event.req.json()
    const share: { shareReview?: "pending" | "rejected" | null; visibility?: "private" | "shared"; access?: "view" | "comment" | "edit" } = {}
    if (body.visibility !== undefined) {
      share.visibility = body.visibility
      share.shareReview = body.visibility === "shared" ? await shareReviewFor(drop.ownerId, event) : null
    }
    if (body.access !== undefined) share.access = body.access
    const title = typeof body.title === "string" ? { title: body.title } : {}
    if (Object.keys(share).length) {
      // A link belongs to the document chain, so every version must carry the same permission state.
      const ids = (await versionChain(drop)).map(item => item.id)
      await db.update(drops).set(share).where(inArray(drops.id, ids))
    }
    if (Object.keys(title).length) await db.update(drops).set(title).where(eq(drops.id, drop.id))
    return toSummary({ ...drop, ...share, ...title })
  },
})
