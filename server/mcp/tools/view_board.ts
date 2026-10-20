import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { boardFrames } from "#shared/board"
import { findDropByRef, permissions } from "../../utils/drops"
import { boardImage, OVERVIEW, readBoard } from "../../utils/boards"
import { requireIdentity } from "../../utils/identity"

export default defineMcpTool({
  name: "view_board",
  title: "Look at a board",
  description:
    "See a board as an image: the whole board, or one frame up close. Use it for what read_drop's outline can't say: sketches, handwriting, circled parts, how things are arranged. Start with the overview, then look at the frames that matter. Images are as of the last time someone had the board open.",
  annotations: { readOnlyHint: true },
  inputSchema: toStandardJsonSchema(
    v.object({
      id: v.pipe(v.string(), v.description("The board's drop id, or its link.")),
      frame: v.optional(
        v.pipe(v.string(), v.description("A frame's id from read_drop. Leave it out for the whole board.")),
      ),
    }),
  ),
  handler: async ({ id, frame }, event) => {
    const who = await requireIdentity(event)
    const drop = await findDropByRef(id, event)
    if (!drop || drop.kind !== "board" || !permissions(drop, who).view)
      throw new HTTPError({ status: 404, message: `No board with id ${id}.` })
    const frames = boardFrames(await readBoard(drop))
    const target = frame ?? OVERVIEW
    if (frame && !frames.some((item) => item.id === frame))
      throw new HTTPError({
        status: 404,
        message: `No frame ${frame}. Frames: ${frames.map((item) => `${item.id} "${item.name}"`).join(", ") || "none"}.`,
      })
    const png = await boardImage(drop, target)
    const others = frames.length
      ? `Frames: ${frames.map((item) => `${item.id} "${item.name}"`).join(", ")}.`
      : "The board has no frames."
    if (!png)
      return {
        content: [
          {
            type: "text" as const,
            text: `No image yet: one is made when someone opens the board in Drop. Read the outline with read_drop meanwhile. ${others}`,
          },
        ],
      }
    return {
      content: [
        { type: "image" as const, data: png, mimeType: "image/png" },
        { type: "text" as const, text: `${frame ? `Frame ${frame}` : "The whole board"}. ${others}` },
      ],
    }
  },
})
