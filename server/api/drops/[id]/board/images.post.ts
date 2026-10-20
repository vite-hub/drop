import { defineValidatedHandler, HTTPError } from "h3"
import * as v from "valibot"
import { MAX_FILE_BYTES } from "#shared/schemas"
import { findDrop, permissions } from "../../../../utils/drops"
import { storeBoardImages } from "../../../../utils/boards"
import { identify } from "../../../../utils/identity"
import { routeId } from "../../../../utils/params"

const BoardImages = v.object({
  images: v.pipe(
    v.array(
      v.object({
        frame: v.pipe(v.string(), v.maxLength(80)),
        png: v.pipe(v.string(), v.maxLength(Math.ceil(MAX_FILE_BYTES / 3) * 4)),
      }),
    ),
    v.maxLength(40),
  ),
})

/** The overview and frame images a browser rendered after saving, for agents to look at (view_board). */
export default defineValidatedHandler({
  validate: { body: BoardImages },
  async handler(event) {
    const drop = await findDrop(await routeId(event), event)
    const who = await identify(event)
    if (!drop || drop.kind !== "board" || !permissions(drop, who).edit)
      throw new HTTPError({ status: 404, statusText: "You can't draw on this board." })
    await storeBoardImages(drop, (await event.req.json()).images)
    return { ok: true }
  },
})
