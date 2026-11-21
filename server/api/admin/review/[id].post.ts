import { and, inArray, eq } from "drizzle-orm"
import { defineValidatedHandler, HTTPError } from "h3"
import { db } from "vite-hub/database"
import { ReviewSchema } from "#shared/schemas"
import { drops, user } from "../../../databases/default/index"
import { requireAdmin } from "../../../utils/identity"
import { logAudit } from "../../../utils/logs"
import { routeId } from "../../../utils/params"

export default defineValidatedHandler({
  validate: { body: ReviewSchema },
  async handler(event) {
    const who = await requireAdmin(event)
    const id = await routeId(event)
    const [owner] = await db.select().from(user).where(eq(user.id, id)).limit(1)
    if (!owner || owner.banned) throw new HTTPError({ status: 400, statusText: "This member is missing or banned." })
    const { action } = await event.req.json()
    if (action === "approve") {
      await db.batch([
        db.update(user).set({ shareApprovedAt: Date.now() }).where(eq(user.id, id)),
        db
          .update(drops)
          .set({ shareReview: null })
          .where(and(eq(drops.ownerId, id), inArray(drops.share, ["public", "public_comment"]))),
      ])
    } else
      await db
        .update(drops)
        .set({ shareReview: "rejected" })
        .where(and(eq(drops.ownerId, id), eq(drops.shareReview, "pending")))
    logAudit(event, who, `share-review.${action}`, { type: "user", id })
    return { ok: true }
  },
})
