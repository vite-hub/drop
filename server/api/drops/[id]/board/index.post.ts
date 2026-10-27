import { defineValidatedHandler, HTTPError } from "h3"
import { requireRateLimit } from "vite-hub/rate-limit"
import * as v from "valibot"
import { findDrop, permissions } from "../../../../utils/drops"
import { writeBoard } from "../../../../utils/boards"
import { identify } from "../../../../utils/identity"
import { routeId } from "../../../../utils/params"

// Each element is checked in writeBoard (isBoardElement); here only that it's a list of objects.
const BoardSave = v.object({ elements: v.pipe(v.array(v.record(v.string(), v.unknown())), v.maxLength(5000)) })

/** Elements a person changed in Excalidraw since their last save. Anyone who may edit the drop may draw on its latest version. */
export default defineValidatedHandler({
  validate: { body: BoardSave },
  async handler(event) {
    const drop = await findDrop(await routeId(event), event)
    const who = await identify(event)
    if (!drop || drop.expired || !permissions(drop, who).edit)
      throw new HTTPError({ status: 404, statusText: "You can't draw on this board." })
    await requireRateLimit(event, "board", { key: who?.userId, limit: 120, window: "1m" })
    const { elements } = await event.req.json()
    const { updatedAt } = await writeBoard(drop, { elements, who })
    return { updatedAt }
  },
})
