// Boards: tldraw whiteboards people draw on together, and agents read and add to. A board drop stores a tldraw store
// snapshot (`.tldr`). People edit it in tldraw itself (app/components/viewer/ViewerBoard.vue); agents never touch
// tldraw records. They write a small format (items and edges, below) that this module turns into validated records,
// and read the board back as a text outline plus an image per frame (server/utils/boards.ts).
import {
  createBindingId,
  createShapeId,
  createTLSchema,
  DocumentRecordType,
  PageRecordType,
  TLDOCUMENT_ID,
  toRichText,
} from "@tldraw/tlschema"
import { getIndexAbove, ZERO_INDEX_KEY } from "@tldraw/utils"

export const BOARD_EXTENSION = ".tldr"
export const BOARD_CONTENT_TYPE = "application/vnd.tldraw+json"

/** tldraw's own schema: the editor validates with the same one, so records written here load as they are. */
export const boardSchema = createTLSchema()

type BoardRecord = { id: string; typeName: string; [key: string]: unknown }
/** A tldraw store snapshot, as `getSnapshot(editor.store).document` returns it. */
export interface BoardSnapshot {
  schema: ReturnType<typeof boardSchema.serialize>
  store: Record<string, BoardRecord>
}

export const BOARD_COLORS = [
  "black",
  "grey",
  "light-violet",
  "violet",
  "blue",
  "light-blue",
  "yellow",
  "orange",
  "green",
  "light-green",
  "light-red",
  "red",
  "white",
] as const
export const BOARD_ITEM_TYPES = ["note", "text", "box", "ellipse", "frame"] as const

/** What an agent writes. `id` is the agent's own short name for it; edges and `in` refer to it. */
export interface BoardItem {
  id: string
  type: (typeof BOARD_ITEM_TYPES)[number]
  /** The note's, box's or text's words; a frame's name. */
  text?: string
  /** A frame's id: the item goes inside it, and x/y count from the frame's corner. */
  in?: string
  x?: number
  y?: number
  w?: number
  h?: number
  color?: (typeof BOARD_COLORS)[number]
}
export interface BoardEdge {
  from: string
  to: string
  label?: string
}
export interface BoardEdit {
  add?: BoardItem[]
  edges?: BoardEdge[]
  /** Items to change, by id: only the fields given change. Moving an item into another frame isn't supported. */
  update?: (Partial<BoardItem> & { id: string })[]
  /** Items to delete, by id, with the arrows that point at them. Deleting a frame deletes what's in it. */
  remove?: string[]
}

const PAGE_ID = "page:page"
const NOTE = 200
const GAP = 40
// Agents write paragraphs where people scribble a few words, so their items use tldraw's plain small type instead
// of the large hand-drawn default. People can still switch any of them in the style panel.
const DEFAULTS = {
  richText: toRichText(""),
  color: "black",
  labelColor: "black",
  size: "s",
  font: "sans",
  align: "middle",
  verticalAlign: "middle",
  growY: 0,
  url: "",
  scale: 1,
}

/** A board with one empty page. */
export function emptyBoard(): BoardSnapshot {
  const document = DocumentRecordType.create({ id: TLDOCUMENT_ID })
  const page = PageRecordType.create({ id: PAGE_ID as never, name: "Page 1", index: "a1" as never })
  return {
    schema: boardSchema.serialize(),
    store: { [document.id]: document as unknown as BoardRecord, [page.id]: page as unknown as BoardRecord },
  }
}

/** Parses a stored board and migrates it to the current tldraw schema. Throws on anything else. */
export function parseBoard(text: string): BoardSnapshot {
  const parsed = JSON.parse(text) as BoardSnapshot
  if (!parsed || typeof parsed !== "object" || !parsed.store || !parsed.schema) throw new Error("Not a board.")
  const result = boardSchema.migrateStoreSnapshot(parsed as never)
  if (result.type === "error") throw new Error(`This board can't be read (${result.reason}).`)
  return { schema: boardSchema.serialize(), store: result.value as unknown as BoardSnapshot["store"] }
}

/** Checks one record against tldraw's schema. Throws with tldraw's message when it doesn't fit. */
export function validateRecord(record: BoardRecord) {
  const type = (boardSchema.types as Record<string, { validate(record: unknown): unknown }>)[record.typeName]
  if (!type) throw new Error(`Unknown record type ${record.typeName}`)
  return type.validate(record) as BoardRecord
}

export const shapeId = (id: string) => (id.startsWith("shape:") ? id : (createShapeId(id) as string))
/** The id agents see and use: the shape's without its `shape:` prefix. */
export const shortId = (id: string) => id.replace(/^shape:/, "")

const shapes = (board: BoardSnapshot) =>
  Object.values(board.store).filter((record) => record.typeName === "shape") as Shape[]
interface Shape extends BoardRecord {
  type: string
  x: number
  y: number
  parentId: string
  index: string
  props: Record<string, any>
  meta: Record<string, unknown>
}

function pageOf(board: BoardSnapshot) {
  const pages = Object.values(board.store).filter((record) => record.typeName === "page")
  return (pages.sort((a, b) => String(a.index).localeCompare(String(b.index)))[0]?.id ?? PAGE_ID) as string
}

function topIndex(board: BoardSnapshot, parentId: string) {
  return shapes(board)
    .filter((shape) => shape.parentId === parentId)
    .reduce((top, shape) => (shape.index > top ? shape.index : top), ZERO_INDEX_KEY as string)
}

/** A shape's box on the page: its own position plus every frame's above it. Rotation is ignored. */
export function pageBounds(board: BoardSnapshot, shape: Shape) {
  let x = shape.x
  let y = shape.y
  for (let parent = board.store[shape.parentId] as Shape | undefined; parent?.typeName === "shape";) {
    x += parent.x
    y += parent.y
    parent = board.store[parent.parentId] as Shape | undefined
  }
  const { w, h } = sizeOf(shape)
  return { x, y, w, h }
}

function sizeOf(shape: Shape) {
  const scale = shape.props.scale ?? 1
  if (shape.type === "note") return { w: NOTE * scale, h: (NOTE + (shape.props.growY ?? 0)) * scale }
  if (typeof shape.props.w === "number" && typeof shape.props.h === "number")
    return { w: shape.props.w * scale, h: (shape.props.h + (shape.props.growY ?? 0)) * scale }
  if (typeof shape.props.w === "number") return { w: shape.props.w * scale, h: 40 * scale }
  return { w: 0, h: 0 }
}

// tldraw measures a note's or a shape's words in the browser when someone types them, and grows the shape down to
// fit (growY). Words an agent sends never meet a browser, so estimate what tldraw would measure: agents' items use
// the sans font at size s (DEFAULTS), 18px with a 1.35 line height, about 10px a character, inside 16px of padding.
// Long words break, so the estimate errs tall; the first browser to open the board fits it exactly (ViewerBoard).
const LABEL = { line: 18 * 1.35, padding: 16, char: 10 }

/** How far a note or shape of w×h must grow down to hold its words. */
export function labelGrowth(text: string, w: number, h: number) {
  if (!text.trim()) return 0
  const perLine = Math.max(1, Math.floor((w - LABEL.padding * 2) / LABEL.char))
  let lines = 0
  for (const paragraph of text.split("\n")) {
    lines++
    let used = 0
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (used && used + 1 + word.length > perLine) {
        lines++
        used = 0
      }
      lines += Math.ceil(word.length / perLine) - 1
      used = (used ? used + 1 : 0) + (word.length % perLine || perLine)
    }
  }
  return Math.max(0, Math.ceil(lines * LABEL.line + LABEL.padding * 2 - h))
}

/** The plain text of a tldraw rich text value. */
function walkRichText(node: any): string {
  return node?.type === "text"
    ? String(node.text ?? "")
    : Array.isArray(node?.content)
      ? node.content.map(walkRichText).join(node.type === "doc" ? "\n" : "")
      : ""
}

export function plainText(rich: unknown): string {
  return walkRichText(rich).trim()
}

function fail(message: string): never {
  throw new Error(message)
}

function textOf(shape: Shape) {
  return shape.type === "frame" ? String(shape.props.name ?? "") : plainText(shape.props.richText)
}

/** A board edit as tldraw records to put and ids to remove. Throws, naming the item, when one doesn't fit. */
export function boardChanges(board: BoardSnapshot, edit: BoardEdit, author: string) {
  const put = new Map<string, BoardRecord>()
  const remove = new Set<string>()
  const page = pageOf(board)
  const current = (id: string) => (put.get(id) ?? board.store[id]) as Shape | undefined
  // Frames first, so items placed in a frame added in the same edit find it.
  const added = [...(edit.add ?? [])].sort((a, b) => Number(b.type === "frame") - Number(a.type === "frame"))
  const children = new Map<string, BoardItem[]>()
  for (const item of added) if (item.in) children.set(item.in, [...(children.get(item.in) ?? []), item])
  let row = contentBottom(board)

  // A frame's grid is four across, and each row is as tall as its tallest item, words included.
  const gridRows = (kids: BoardItem[]) => {
    const rows: number[] = []
    kids.forEach((kid, slot) => {
      const { h, growY } = itemSize(kid)
      rows[Math.floor(slot / 4)] = Math.max(rows[Math.floor(slot / 4)] ?? 0, h + growY)
    })
    return rows.length ? rows : [NOTE]
  }
  const itemSize = (item: BoardItem): { w: number; h: number; growY: number } => {
    if (item.type === "frame") {
      const kids = children.get(item.id) ?? []
      const columns = Math.min(Math.max(kids.length, 1), 4)
      return {
        w: item.w ?? columns * (NOTE + GAP) + GAP,
        h: item.h ?? gridRows(kids).reduce((sum, height) => sum + height + GAP, GAP * 2),
        growY: 0,
      }
    }
    if (item.type === "text") return { w: item.w ?? NOTE, h: item.h ?? 40, growY: 0 }
    // A note is always 200 wide and grows down; a box or ellipse grows down past the height it was given.
    const w = item.type === "note" ? NOTE : (item.w ?? NOTE)
    const h = item.type === "note" ? NOTE : (item.h ?? NOTE)
    return { w, h, growY: labelGrowth(item.text ?? "", w, h) }
  }

  for (const item of added) {
    const id = shapeId(item.id)
    if (!/^[\w-]{1,64}$/.test(shortId(id))) fail(`Item id "${item.id}" may only use letters, digits, _ and -.`)
    if (current(id)) fail(`The board already has an item "${item.id}". Pick another id, or change it with update.`)
    const parentId = item.in ? shapeId(item.in) : page
    const parent = item.in ? current(parentId) : undefined
    if (item.in && parent?.type !== "frame") fail(`"${item.in}", which "${item.id}" goes in, isn't a frame.`)
    const siblings = item.in ? (children.get(item.in) ?? []) : []
    const slot = siblings.indexOf(item)
    const size = itemSize(item)
    // Without x/y: items in a frame fill its grid, four across; loose items and frames start a row below the board.
    let x = item.x
    let y = item.y
    if (x === undefined || y === undefined) {
      if (item.in && slot >= 0) {
        const above = gridRows(siblings).slice(0, Math.floor(slot / 4))
        x ??= GAP + (slot % 4) * (NOTE + GAP)
        y ??= above.reduce((sum, height) => sum + height + GAP, GAP * 1.5)
      } else {
        x ??= 0
        y ??= row
        row = y + size.h + size.growY + GAP * 2
      }
    }
    const index = getIndexAbove(
      topIndex({ ...board, store: { ...board.store, ...Object.fromEntries(put) } }, parentId) as never,
    )
    const props = shapeProps(item, size)
    put.set(
      id,
      validateRecord({
        id,
        typeName: "shape",
        type: props.type,
        x,
        y,
        rotation: 0,
        index,
        parentId,
        isLocked: false,
        opacity: 1,
        props: props.props,
        meta: { author, agent: true },
      }),
    )
  }

  for (const change of edit.update ?? []) {
    const id = shapeId(change.id)
    const shape = current(id)
    if (!shape) fail(`The board has no item "${change.id}".`)
    const next = structuredClone(shape!) as Shape
    if (change.x !== undefined) next.x = change.x
    if (change.y !== undefined) next.y = change.y
    if (change.text !== undefined) {
      if (next.type === "frame") next.props.name = change.text
      else if ("richText" in next.props) next.props.richText = toRichText(change.text)
      else fail(`"${change.id}" is a ${next.type}, which holds no text.`)
    }
    if (change.color !== undefined && "color" in next.props) next.props.color = change.color
    if (change.w !== undefined && "w" in next.props) next.props.w = change.w
    if (change.h !== undefined && "h" in next.props) next.props.h = change.h
    if ("growY" in next.props && (change.text !== undefined || change.w !== undefined || change.h !== undefined))
      next.props.growY =
        next.type === "note"
          ? labelGrowth(plainText(next.props.richText), NOTE, NOTE)
          : labelGrowth(plainText(next.props.richText), next.props.w, next.props.h)
    next.meta = { ...next.meta, editedBy: author }
    put.set(id, validateRecord(next))
  }

  for (const edge of edit.edges ?? []) {
    const from = current(shapeId(edge.from))
    const to = current(shapeId(edge.to))
    if (!from) fail(`An edge starts at "${edge.from}", which isn't on the board.`)
    if (!to) fail(`An edge ends at "${edge.to}", which isn't on the board.`)
    const merged = { ...board, store: { ...board.store, ...Object.fromEntries(put) } }
    const a = pageBounds(merged, from!)
    const b = pageBounds(merged, to!)
    const start = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
    const end = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    const id = createShapeId() as string
    put.set(
      id,
      validateRecord({
        id,
        typeName: "shape",
        type: "arrow",
        x: start.x,
        y: start.y,
        rotation: 0,
        index: getIndexAbove(topIndex(merged, page) as never),
        parentId: page,
        isLocked: false,
        opacity: 1,
        props: {
          ...ARROW,
          start: { x: 0, y: 0 },
          end: { x: end.x - start.x || 1, y: end.y - start.y },
          richText: toRichText(edge.label ?? ""),
        },
        meta: { author, agent: true },
      }),
    )
    for (const [terminal, target] of [
      ["start", from!],
      ["end", to!],
    ] as const) {
      const binding = createBindingId() as string
      put.set(
        binding,
        validateRecord({
          id: binding,
          typeName: "binding",
          type: "arrow",
          fromId: id,
          toId: target.id,
          props: { terminal, ...ARROW_BINDING },
          meta: {},
        }),
      )
    }
  }

  for (const ref of edit.remove ?? []) {
    const id = shapeId(ref)
    if (!current(id)) fail(`The board has no item "${ref}".`)
    const doomed = [id]
    for (let i = 0; i < doomed.length; i++)
      for (const shape of shapes(board)) if (shape.parentId === doomed[i]) doomed.push(shape.id)
    for (const gone of doomed) {
      remove.add(gone)
      put.delete(gone)
      // An arrow bound to a deleted item would point at nothing, so it goes too, with its bindings.
      for (const binding of bindings(board))
        if (binding.toId === gone || binding.fromId === gone) {
          remove.add(binding.id)
          if (binding.toId === gone) remove.add(binding.fromId)
        }
    }
  }
  for (const id of remove) put.delete(id)
  return { put: [...put.values()], remove: [...remove] }
}

/** Applies changes to a board in place: what the server stores after people or agents edit. */
export function applyChanges(board: BoardSnapshot, put: BoardRecord[], remove: string[]) {
  for (const id of remove) delete board.store[id]
  for (const record of put) board.store[record.id] = record
  return board
}

const ARROW = {
  kind: "arc",
  elbowMidPoint: 0.5,
  dash: "draw",
  size: "m",
  fill: "none",
  color: "black",
  labelColor: "black",
  bend: 0,
  arrowheadStart: "none",
  arrowheadEnd: "arrow",
  labelPosition: 0.5,
  font: "draw",
  scale: 1,
}
const ARROW_BINDING = { isPrecise: false, isExact: false, normalizedAnchor: { x: 0.5, y: 0.5 }, snap: "none" }

function shapeProps(
  item: BoardItem,
  size: { w: number; h: number; growY: number },
): { type: string; props: Record<string, unknown> } {
  const color = item.color ?? (item.type === "note" ? "yellow" : "black")
  const richText = toRichText(item.text ?? "")
  switch (item.type) {
    case "note":
      return {
        type: "note",
        props: { ...DEFAULTS, color, richText, growY: size.growY, fontSizeAdjustment: 1, textLastEditedBy: null },
      }
    case "text":
      return {
        type: "text",
        props: { color, size: "s", w: size.w, font: "sans", textAlign: "start", autoSize: !item.w, scale: 1, richText },
      }
    case "frame":
      return { type: "frame", props: { w: size.w, h: size.h, name: item.text ?? "", color } }
    default:
      return {
        type: "geo",
        props: {
          ...DEFAULTS,
          geo: item.type === "ellipse" ? "ellipse" : "rectangle",
          dash: "draw",
          fill: "none",
          flipX: false,
          flipY: false,
          w: size.w,
          h: size.h,
          growY: size.growY,
          color,
          richText,
        },
      }
  }
}

function contentBottom(board: BoardSnapshot) {
  const page = pageOf(board)
  const top = shapes(board).filter((shape) => shape.parentId === page)
  if (!top.length) return 0
  return Math.max(...top.map((shape) => pageBounds(board, shape)).map((box) => box.y + box.h)) + GAP * 2
}

interface Binding extends BoardRecord {
  type: string
  fromId: string
  toId: string
  props: { terminal: "start" | "end" }
}
const bindings = (board: BoardSnapshot) =>
  Object.values(board.store).filter((record) => record.typeName === "binding") as Binding[]

/** A frame on the board, for the per-frame images agents look at. */
export function boardFrames(board: BoardSnapshot) {
  return shapes(board)
    .filter((shape) => shape.type === "frame")
    .map((shape) => ({ id: shortId(shape.id), name: textOf(shape) || "Untitled frame" }))
}

const round = (n: number) => Math.round(n)

/**
 * The board as text for agents: each frame with what's in it, then everything outside frames. Every line names the
 * item's id (for edges, update and remove), its words, where it is, and who added it. Arrows read `a → b`; freehand
 * drawings only say where they are, since their meaning is in the frame's image.
 */
export function boardOutline(board: BoardSnapshot) {
  const all = shapes(board)
  const arrows = new Map<string, { start?: string; end?: string }>()
  for (const binding of bindings(board)) {
    const ends = arrows.get(binding.fromId) ?? {}
    ends[binding.props.terminal] = binding.toId
    arrows.set(binding.fromId, ends)
  }
  const name = (id?: string) => {
    const shape = id ? (board.store[id] as Shape | undefined) : undefined
    if (!shape) return "nothing"
    const text = textOf(shape)
    return text ? `${shortId(shape.id)} "${clip(text, 40)}"` : shortId(shape.id)
  }
  const line = (shape: Shape, depth: number): string[] => {
    const box = pageBounds(board, shape)
    const by = typeof shape.meta?.author === "string" ? ` by ${shape.meta.author}` : ""
    const at = `(${round(box.x)},${round(box.y)}${box.w ? ` ${round(box.w)}×${round(box.h)}` : ""})`
    const pad = "  ".repeat(depth)
    const text = textOf(shape)
    let head: string
    if (shape.type === "arrow") {
      const ends = arrows.get(shape.id) ?? {}
      const label = text ? ` "${clip(text, 60)}"` : ""
      head = `arrow ${shortId(shape.id)}: ${name(ends.start)} → ${name(ends.end)}${label}${by}`
    } else if (shape.type === "frame") {
      head = `frame ${shortId(shape.id)} "${text || "Untitled frame"}" ${at}${by}`
    } else {
      const kind =
        shape.type === "geo" ? String(shape.props.geo) : shape.type === "draw" ? "drawing" : (shape.type as string)
      head = `${kind} ${shortId(shape.id)}${text ? ` "${clip(text, 400)}"` : ""} ${at}${by}`
    }
    const inner = all
      .filter((child) => child.parentId === shape.id && child.type !== "arrow")
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .flatMap((child) => line(child, depth + 1))
    return [pad + head, ...inner]
  }
  const page = pageOf(board)
  const top = all.filter((shape) => shape.parentId === page)
  const frames = top.filter((shape) => shape.type === "frame").sort((a, b) => a.y - b.y || a.x - b.x)
  const loose = top
    .filter((shape) => shape.type !== "frame" && shape.type !== "arrow")
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const links = all.filter((shape) => shape.type === "arrow")
  const parts = frames.map((frame) => line(frame, 0).join("\n"))
  if (loose.length) parts.push(["Outside frames:", ...loose.flatMap((shape) => line(shape, 1))].join("\n"))
  if (links.length) parts.push(["Arrows:", ...links.flatMap((shape) => line(shape, 1))].join("\n"))
  return parts.join("\n\n") || "The board is empty."
}

/** The board's words, for search. */
export const boardText = (board: BoardSnapshot) => shapes(board).map(textOf).filter(Boolean).join("\n")

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ")
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
