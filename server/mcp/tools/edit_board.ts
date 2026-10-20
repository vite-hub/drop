import { toStandardJsonSchema } from "@valibot/to-json-schema"
import { HTTPError } from "h3"
import { defineMcpTool } from "nitro-mcp-toolkit"
import * as v from "valibot"
import { boardOutline } from "#shared/board"
import { findDropByRef, permissions, versionsOf } from "../../utils/drops"
import { writeBoard } from "../../utils/boards"
import { requireIdentity } from "../../utils/identity"
import { BoardEdgeInput, BoardItemInput } from "../board"

export default defineMcpTool({
  name: "edit_board",
  title: "Edit a board",
  description:
    "Add to a board, change it, or clean it up, while people may be drawing on it: add items and arrows, update an item's text, color, size or place, or remove items. Ids are the ones read_drop shows. People see the change the next time their board syncs. Change only what you were asked to; people's own drawings stay theirs.",
  inputSchema: toStandardJsonSchema(
    v.object({
      id: v.pipe(v.string(), v.description("The board's drop id, or its link.")),
      add: v.optional(v.pipe(v.array(BoardItemInput), v.maxLength(500))),
      edges: v.optional(v.pipe(v.array(BoardEdgeInput), v.maxLength(500), v.description("Arrows to add."))),
      update: v.optional(
        v.pipe(
          v.array(v.partial(BoardItemInput, ["type", "in", "text", "x", "y", "w", "h", "color"])),
          v.maxLength(500),
          v.description("Items to change, by id; only the fields you pass change. type and in can't change."),
        ),
      ),
      remove: v.optional(
        v.pipe(
          v.array(v.string()),
          v.maxLength(500),
          v.description("Ids to delete, with the arrows attached to them; a frame takes what's inside with it."),
        ),
      ),
    }),
  ),
  handler: async ({ id, ...edit }, event) => {
    const who = await requireIdentity(event)
    const drop = await findDropByRef(id, event)
    if (!drop || drop.kind !== "board" || !permissions(drop, who).edit)
      throw new HTTPError({ status: 404, message: `No board with id ${id} you can edit.` })
    if ((await versionsOf(drop))[0]?.id !== drop.id || drop.expired)
      throw new HTTPError({ status: 409, message: "That's an older version of the board; edit the latest one." })
    const { board, put, remove } = await writeBoard(drop, { edit, who })
    return {
      content: [
        {
          type: "text" as const,
          text: `Changed ${put} records, removed ${remove}. The board now:\n\n${boardOutline(board)}`,
        },
      ],
      structuredContent: { id: drop.id, put, remove },
    }
  },
})
