import { eq, inArray } from "drizzle-orm"
import { defineValidatedHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { DropPatchSchema } from "#shared/schemas"
import { drops } from "../../databases/config"
import { findDrop, permissions, toSummary, versionChain } from "../../utils/drops"
import { expiryPolicy, renewDrop } from "../../utils/expiry"
import { requireIdentity } from "../../utils/identity"
import { shareReviewFor } from "../../utils/trust"
import { routeId } from "../../utils/params"

/** Share, unshare, change the link's access level, rename, renew, or keep forever. */
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
    // Agents can only ask to keep a drop forever; the person behind them decides.
    const expiry: { neverExpires?: boolean; neverExpiresRequest?: string | null } = {}
    if (body.neverExpires === true && who.actorKind === "agent") {
      if (!drop.neverExpires) expiry.neverExpiresRequest = who.actorName
    }
    else if (body.neverExpires === true) {
      if (!expiryPolicy(event).custom && who.role !== "admin") throw new HTTPError({ status: 403, statusText: "Only admins can keep drops forever on this Drop." })
      Object.assign(expiry, { neverExpires: true, neverExpiresRequest: null })
    }
    else if (body.neverExpires === false) Object.assign(expiry, { neverExpires: false, neverExpiresRequest: null })
    const chainChange = { ...share, ...expiry }
    if (Object.keys(chainChange).length) {
      // A link and its lifetime belong to the document chain, so every version carries the same state.
      const ids = (await versionChain(drop)).map(item => item.id)
      await db.update(drops).set(chainChange).where(inArray(drops.id, ids))
    }
    if (Object.keys(title).length) await db.update(drops).set(title).where(eq(drops.id, drop.id))
    const renewed = body.renew ? { lastAccessedAt: Date.now() } : {}
    if (body.renew) await renewDrop(drop, renewed.lastAccessedAt)
    return toSummary({ ...drop, ...chainChange, ...title, ...renewed }, undefined, expiryPolicy(event).days)
  },
})
