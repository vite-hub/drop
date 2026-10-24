import * as v from "valibot"
import { BOARD_COLORS, BOARD_ITEM_TYPES } from "#shared/board"

// The board format agents write (shared/board.ts turns it into Excalidraw elements). No transforms: every input schema
// becomes JSON Schema for tools/list.

const id = v.pipe(
  v.string(),
  v.regex(/^[\w-]{1,64}$/),
  v.description("A short id you pick, like signup or q3-risks; edges, in, update and remove use it."),
)
const coordinate = (what: string) =>
  v.optional(v.pipe(v.number(), v.minValue(-1e6), v.maxValue(1e6), v.description(what)))

export const BoardItemInput = v.object({
  id,
  type: v.pipe(
    v.picklist(BOARD_ITEM_TYPES),
    v.description(
      "note: a sticky note (200×200). text: words on the board. box, ellipse: a shape with a label. frame: a named area that holds other items.",
    ),
  ),
  text: v.optional(v.pipe(v.string(), v.maxLength(4000), v.description("Its words; a frame's name."))),
  in: v.optional(
    v.pipe(v.string(), v.description("A frame's id. The item goes inside it, and x and y count from its corner.")),
  ),
  x: coordinate(
    "Left edge. Leave x and y out to lay items out for you: in a frame, a grid four across; outside, a row below the board.",
  ),
  y: coordinate("Top edge."),
  w: v.optional(
    v.pipe(v.number(), v.minValue(1), v.maxValue(20000), v.description("Width; a frame fits its items by default.")),
  ),
  h: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(20000), v.description("Height."))),
  color: v.optional(v.picklist(BOARD_COLORS)),
})

export const BoardEdgeInput = v.object({
  from: v.pipe(v.string(), v.description("The id of the item the arrow starts at.")),
  to: v.pipe(v.string(), v.description("The id of the item it points to.")),
  label: v.optional(v.pipe(v.string(), v.maxLength(200))),
})

export const BoardInput = v.pipe(
  v.object({
    items: v.pipe(v.array(BoardItemInput), v.maxLength(500)),
    edges: v.optional(v.pipe(v.array(BoardEdgeInput), v.maxLength(500))),
  }),
  v.description(
    "A whiteboard people draw on together (Excalidraw): frames, sticky notes, text, shapes, and arrows between them. Use it for flows, maps, retros and anything spatial; people then draw, move and add to it, and you read it back with read_drop and view_board.",
  ),
)
