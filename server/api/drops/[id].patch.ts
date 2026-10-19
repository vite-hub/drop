import { defineValidatedHandler, HTTPError } from "h3"
import { DropPatchSchema } from "#shared/schemas"
import { findDrop } from "../../utils/drops"
import { updateDrop } from "../../utils/drop-update"
import { requireIdentity } from "../../utils/identity"
import { routeId } from "../../utils/params"

/** Share, unshare, rename, rename the link, describe a folder, change the lifetime, renew, trash, restore, or move. */
export default defineValidatedHandler({
  validate: { body: DropPatchSchema },
  async handler(event) {
    const who = await requireIdentity(event)
    const drop = await findDrop(await routeId(event), event)
    if (!drop) throw new HTTPError({ status: 404, statusText: "No drop with that id." })
    return updateDrop(drop, who, await event.req.json(), event)
  },
})
