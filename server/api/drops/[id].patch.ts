import { eq } from "drizzle-orm"
import { defineValidatedHandler, HTTPError } from "h3"
import { db } from "vite-hub/database/drizzle"
import { DropPatchSchema } from "#shared/schemas"
import { drops } from "../../databases/config"
import { findDrop, permissions, toSummary } from "../../utils/drops"
import { requireIdentity } from "../../utils/identity"
import { routeId } from "../../utils/params"

/** Share, unshare, change the link's access level, or rename. */
export default defineValidatedHandler({
  validate: { body: DropPatchSchema },
  async handler(event) {
    const who = await requireIdentity(event)
    const drop = await findDrop(await routeId(event))
    if (!drop || !permissions(drop, who).manage) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
    const body = await event.req.json()
    await db.update(drops).set({ ...body }).where(eq(drops.id, drop.id))
    return toSummary({ ...drop, ...body })
  },
})
