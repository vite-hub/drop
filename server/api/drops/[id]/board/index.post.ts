import { defineValidatedHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import * as v from "valibot"
import { findDrop, permissions, versionsOf } from "../../../../utils/drops"
import { writeBoard } from "../../../../utils/boards"
import { identify } from "../../../../utils/identity"
import { routeId } from "../../../../utils/params"

const BoardSave = v.object({
  put: v.optional(v.pipe(v.array(v.record(v.string(), v.unknown())), v.maxLength(5000))),
  remove: v.optional(v.pipe(v.array(v.string()), v.maxLength(5000))),
})

/** Records a person changed in tldraw since their last save. Anyone who may edit the drop may draw on its latest version. */
export default defineValidatedHandler({
  validate: { body: BoardSave },
  async handler(event) {
    const drop = await findDrop(await routeId(event), event)
    const who = await identify(event)
    if (!drop || drop.expired || !permissions(drop, who).edit || (await versionsOf(drop))[0]?.id !== drop.id)
      throw new HTTPError({ status: 404, statusText: "You can't draw on this board." })
    await requireRateLimit(event, "board", { key: who?.userId, limit: 120, window: "1m" })
    const { updatedAt } = await writeBoard(drop, await event.req.json())
    return { updatedAt }
  },
})
