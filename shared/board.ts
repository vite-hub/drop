// Boards: Excalidraw whiteboards people draw on together, and agents read and add to. A board drop stores an
// Excalidraw scene (`.excalidraw`, the file excalidraw.com opens). People edit it in Excalidraw itself
// (app/components/viewer/ViewerBoard.vue); agents never touch elements. They write a small format (items and edges,
// below) that this module turns into elements, and read the board back as a text outline plus an image per frame
// (server/utils/boards.ts).
//
// Every element carries a version that goes up with each change, and a deleted element stays in the scene marked
// isDeleted. That is how Excalidraw merges scenes, and how Drop does too: per element, the higher version wins
// (mergeElements), so a deletion reaches every open board like any other change.
import { generateNKeysBetween } from "fractional-indexing"
import * as v from "valibot"

export const BOARD_EXTENSION = ".excalidraw"
export const BOARD_CONTENT_TYPE = "application/vnd.excalidraw+json"

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
type BoardColor = (typeof BOARD_COLORS)[number]

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
  color?: BoardColor
}
interface BoardEdge {
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

/** An Excalidraw element: the fields Drop reads and writes. Excalidraw keeps the rest as they are. */
export interface BoardElement {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  version: number
  versionNonce: number
  isDeleted: boolean
  index?: string | null
  frameId?: string | null
  containerId?: string | null
  boundElements?: { id: string; type: string }[] | null
  text?: string
  originalText?: string
  name?: string | null
  startBinding?: { elementId: string } | null
  endBinding?: { elementId: string } | null
  /** Drop's own: who added it, whether an agent did, what kind of item, and `fit` on words no browser measured yet. */
  customData?: {
    author?: string
    agent?: boolean
    kind?: string
    editedBy?: string
    fit?: boolean
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** An Excalidraw scene, the `.excalidraw` file. */
export interface Board {
  type: "excalidraw"
  version: 2
  source: string
  elements: BoardElement[]
  appState: Record<string, unknown>
  files: Record<string, unknown>
}

const NOTE = 200
const GAP = 40

/** A board with nothing on it. */
export function emptyBoard(): Board {
  return {
    type: "excalidraw",
    version: 2,
    source: "https://drop.vitehub.dev",
    elements: [],
    appState: { viewBackgroundColor: "#ffffff", gridSize: 20 },
    files: {},
  }
}

// Shapes, lines, text and frames. Images and embeds need files and URLs Drop doesn't keep, so boards don't take them.
const ELEMENT_TYPES = ["rectangle", "diamond", "ellipse", "arrow", "line", "freedraw", "text", "frame"] as const
const finite = v.pipe(v.number(), v.finite())
const Element = v.looseObject({
  id: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  type: v.picklist(ELEMENT_TYPES),
  x: finite,
  y: finite,
  width: finite,
  height: finite,
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
  versionNonce: v.pipe(v.number(), v.integer()),
  isDeleted: v.boolean(),
})
const BoardFile = v.object({
  type: v.literal("excalidraw"),
  elements: v.array(v.looseObject({ id: v.string(), type: v.string() })),
})

/** Whether an element from a browser is one a board stores: a shape, line, text or frame with the fields Drop reads. */
export function isBoardElement(element: unknown): element is BoardElement {
  return v.is(Element, element)
}

/** Parses a `.excalidraw` file. Elements a board doesn't take (images, embeds) are left out. Throws on anything else. */
export function parseBoard(text: string): Board {
  const parsed = v.safeParse(BoardFile, JSON.parse(text))
  if (!parsed.success) throw new Error("Not a board.")
  return { ...emptyBoard(), elements: parsed.output.elements.filter(isBoardElement) }
}

/** A board as a `.excalidraw` file: what Drop stores and serves, so a downloaded board opens in excalidraw.com. */
export const serializeBoard = (board: Board) => JSON.stringify(board)

/**
 * Merges elements into a board in place, the way Excalidraw reconciles scenes: per element, the higher version wins,
 * and on a tie the lower versionNonce. Who added an element stays as it was; a new element without one gets `author`,
 * which read_drop's outline shows. Returns how many elements changed.
 */
export function mergeElements(board: Board, incoming: BoardElement[], author?: string) {
  const at = new Map(board.elements.map((element, i) => [element.id, i]))
  let changed = 0
  for (const element of incoming) {
    const i = at.get(element.id)
    const stored = i === undefined ? undefined : board.elements[i]
    if (
      stored &&
      (stored.version > element.version ||
        (stored.version === element.version && stored.versionNonce <= element.versionNonce))
    )
      continue
    const by = stored ? stored.customData?.author : (element.customData?.author ?? author)
    const next = by ? { ...element, customData: { ...element.customData, author: by } } : element
    if (i === undefined) {
      at.set(element.id, board.elements.length)
      board.elements.push(next)
    } else board.elements[i] = next
    changed++
  }
  return changed
}

// Excalidraw's palette (open-color), as each agent color's line and fill: notes are filled, shapes and text outlined.
const PALETTE: Record<BoardColor, { stroke: string; fill: string }> = {
  black: { stroke: "#1e1e1e", fill: "#e9ecef" },
  grey: { stroke: "#868e96", fill: "#e9ecef" },
  "light-violet": { stroke: "#9c36b5", fill: "#eebefa" },
  violet: { stroke: "#6741d9", fill: "#d0bfff" },
  blue: { stroke: "#1971c2", fill: "#a5d8ff" },
  "light-blue": { stroke: "#0c8599", fill: "#99e9f2" },
  yellow: { stroke: "#f08c00", fill: "#ffec99" },
  orange: { stroke: "#e8590c", fill: "#ffd8a8" },
  green: { stroke: "#2f9e44", fill: "#b2f2bb" },
  "light-green": { stroke: "#099268", fill: "#96f2d7" },
  "light-red": { stroke: "#f08c8c", fill: "#ffc9c9" },
  red: { stroke: "#e03131", fill: "#ffc9c9" },
  white: { stroke: "#ced4da", fill: "#ffffff" },
}

// Agents write paragraphs where people scribble a few words, so their items use a plain font at 16 px instead of the
// hand-drawn default. It's Excalidraw's Helvetica, a system font: Excalidraw's own fonts load from a CDN, and a label
// measured before they arrive keeps the narrower fallback's widths, so its words spill out of the shape. People can
// still switch any item to another font in the style panel.
const FONT = { family: 2, size: 16, lineHeight: 1.15 }
// Excalidraw wraps a label to its shape's width by measuring the words, which only a browser can do: the first browser
// that opens the board measures every label marked `fit` and saves it (ViewerBoard). Excalidraw doesn't grow a shape
// to fit its label, so the shape's height comes from an estimate here: about 9 px a character at 16 px, inside
// Excalidraw's 5 px label padding plus some air. Long words break, so the estimate errs tall.
const LABEL = { line: FONT.size * FONT.lineHeight, padding: 16, char: 9 }

/** How tall a label of `text` is when wrapped to `w`. */
function textHeight(text: string, w: number) {
  const perLine = Math.max(1, Math.floor(w / LABEL.char))
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
  return Math.ceil(lines * LABEL.line)
}

/** How far a note or shape of w×h must grow down to hold its words. */
export function labelGrowth(text: string, w: number, h: number) {
  if (!text.trim()) return 0
  return Math.max(0, textHeight(text, w - LABEL.padding * 2) + LABEL.padding * 2 - h)
}

const random = () => Math.floor(Math.random() * 2 ** 31)

function makeElement(fields: Partial<BoardElement> & Pick<BoardElement, "id" | "type">): BoardElement {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: null,
    roundness: null,
    seed: random(),
    version: 1,
    versionNonce: random(),
    isDeleted: false,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    ...fields,
  }
}

/** The same element, changed: its version goes up, so every open board takes the change. */
const bump = (stored: BoardElement, fields: Partial<BoardElement>): BoardElement => ({
  ...stored,
  ...fields,
  version: stored.version + 1,
  versionNonce: random(),
  updated: Date.now(),
})

const textId = (id: string) => `${id}:text`

/** A label inside a shape or on an arrow, centered in `box`. */
function labelFor(container: BoardElement, text: string, box: { x: number; y: number; w: number; h: number }) {
  const width = Math.max(1, box.w - LABEL.padding * 2)
  const height = textHeight(text, width)
  return makeElement({
    id: textId(container.id),
    type: "text",
    x: box.x + (box.w - width) / 2,
    y: box.y + (box.h - height) / 2,
    width,
    height,
    strokeColor: "#1e1e1e",
    frameId: container.frameId ?? null,
    text,
    originalText: text,
    fontSize: FONT.size,
    fontFamily: FONT.family,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: container.id,
    autoResize: true,
    lineHeight: FONT.lineHeight,
    customData: { ...container.customData, fit: true },
  })
}

const live = (board: Board) => board.elements.filter((element) => !element.isDeleted)
/** What a board shows as items: everything but the labels inside shapes and on arrows. */
const items = (board: Board) => live(board).filter((element) => !element.containerId)
const isFrame = (element: BoardElement) => element.type === "frame" || element.type === "magicframe"

/** The words of an item: a frame's name, a text's own words, or its label's. */
function textOf(board: Board, item: BoardElement) {
  if (isFrame(item)) return item.name ?? ""
  if (item.type === "text") return item.originalText ?? item.text ?? ""
  const bound = item.boundElements?.find((each) => each.type === "text")
  const text = bound && board.elements.find((each) => each.id === bound.id && !each.isDeleted)
  return text ? (text.originalText ?? text.text ?? "") : ""
}

/** Where an arrow between two boxes leaves the first: on its edge, toward the second's center. */
function edgePoint(from: Box, to: Box) {
  const cx = from.x + from.w / 2
  const cy = from.y + from.h / 2
  const dx = to.x + to.w / 2 - cx
  const dy = to.y + to.h / 2 - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const t = Math.min(dx ? from.w / 2 / Math.abs(dx) : Infinity, dy ? from.h / 2 / Math.abs(dy) : Infinity)
  const gap = 8 / Math.hypot(dx, dy)
  return { x: cx + dx * (t + gap), y: cy + dy * (t + gap) }
}
interface Box {
  x: number
  y: number
  w: number
  h: number
}
const boxOf = (element: BoardElement): Box => ({ x: element.x, y: element.y, w: element.width, h: element.height })

const fail = (message: string): never => {
  throw new Error(message)
}

/**
 * A board edit as the elements to merge (mergeElements): new ones, and changed or deleted ones with their version
 * raised. Throws, naming the item, when one doesn't fit.
 */
export function boardChanges(board: Board, edit: BoardEdit, author: string) {
  const put = new Map<string, BoardElement>()
  const current = (id: string) =>
    put.get(id) ?? board.elements.find((element) => element.id === id && !element.isDeleted)
  const change = (id: string, fields: Partial<BoardElement>) => {
    const stored = current(id)
    if (!stored) return
    // Whatever is in put is new or already went up a version in this edit: it goes up once.
    put.set(id, put.has(id) ? { ...stored, ...fields } : bump(stored, fields))
  }
  const meta = { author, agent: true }

  // Frames first, so items placed in a frame added in the same edit find it.
  const added = [...(edit.add ?? [])].sort((a, b) => Number(b.type === "frame") - Number(a.type === "frame"))
  const children = new Map<string, BoardItem[]>()
  for (const item of added) if (item.in) children.set(item.in, [...(children.get(item.in) ?? []), item])
  let row = contentBottom(board)

  // A frame's grid is four across, and each row is as tall as its tallest item, words included.
  const gridRows = (kids: BoardItem[]) => {
    const rows: number[] = []
    kids.forEach((kid, slot) => {
      const { h } = itemSize(kid)
      rows[Math.floor(slot / 4)] = Math.max(rows[Math.floor(slot / 4)] ?? 0, h)
    })
    return rows.length ? rows : [NOTE]
  }
  const itemSize = (item: BoardItem): { w: number; h: number } => {
    if (item.type === "frame") {
      const kids = children.get(item.id) ?? []
      const columns = Math.min(Math.max(kids.length, 1), 4)
      const widest = Math.max(NOTE, ...kids.map((kid) => itemSize(kid).w))
      return {
        w: item.w ?? columns * (widest + GAP) + GAP,
        h: item.h ?? gridRows(kids).reduce((sum, height) => sum + height + GAP, GAP * 2),
      }
    }
    if (item.type === "text") {
      const w = item.w ?? 400
      return { w, h: item.h ?? textHeight(item.text ?? "", w) }
    }
    // A note is always 200 wide and grows down; a box or ellipse grows down past the height it was given.
    const w = item.type === "note" ? NOTE : (item.w ?? NOTE)
    const h = item.type === "note" ? NOTE : (item.h ?? NOTE)
    return { w, h: h + labelGrowth(item.text ?? "", w, h) }
  }

  for (const item of added) {
    if (!/^[\w-]{1,64}$/.test(item.id)) fail(`Item id "${item.id}" may only use letters, digits, _ and -.`)
    if (current(item.id) || board.elements.some((element) => element.id === item.id))
      fail(`The board already has an item "${item.id}". Pick another id, or change it with update.`)
    const frame = item.in ? current(item.in) : undefined
    if (item.in && (!frame || !isFrame(frame))) fail(`"${item.in}", which "${item.id}" goes in, isn't a frame.`)
    const siblings = item.in ? (children.get(item.in) ?? []) : []
    const slot = siblings.indexOf(item)
    const size = itemSize(item)
    // Without x/y: items in a frame fill its grid, four across; loose items and frames start a row below the board.
    let x = item.x
    let y = item.y
    if (x === undefined || y === undefined) {
      if (item.in && slot >= 0) {
        const above = gridRows(siblings).slice(0, Math.floor(slot / 4))
        const widest = Math.max(NOTE, ...siblings.map((kid) => itemSize(kid).w))
        x ??= GAP + (slot % 4) * (widest + GAP)
        y ??= above.reduce((sum, height) => sum + height + GAP, GAP * 1.5)
      } else {
        x ??= 0
        y ??= row
        row = y + size.h + GAP * 2
      }
    }
    if (frame) {
      x += frame.x
      y += frame.y
    }
    const palette = PALETTE[item.color ?? (item.type === "note" ? "yellow" : "black")]
    const base = { id: item.id, x, y, width: size.w, height: size.h, frameId: frame?.id ?? null, customData: meta }
    if (item.type === "frame") {
      put.set(item.id, makeElement({ ...base, type: "frame", name: item.text ?? "", strokeColor: "#bbb" }))
    } else if (item.type === "text") {
      const text = item.text ?? ""
      put.set(
        item.id,
        makeElement({
          ...base,
          type: "text",
          strokeColor: palette.stroke === PALETTE.white.stroke ? "#1e1e1e" : palette.stroke,
          text,
          originalText: text,
          fontSize: FONT.size,
          fontFamily: FONT.family,
          textAlign: "left",
          verticalAlign: "top",
          containerId: null,
          autoResize: false,
          lineHeight: FONT.lineHeight,
          customData: { ...meta, kind: "text", fit: true },
        }),
      )
    } else {
      const shape = makeElement({
        ...base,
        type: item.type === "ellipse" ? "ellipse" : "rectangle",
        roundness: item.type === "ellipse" ? { type: 2 } : { type: 3 },
        ...(item.type === "note"
          ? { strokeColor: palette.fill, backgroundColor: palette.fill, fillStyle: "solid" }
          : { strokeColor: palette.stroke }),
        customData: { ...meta, kind: item.type },
      })
      put.set(item.id, shape)
      if (item.text) {
        shape.boundElements = [{ id: textId(item.id), type: "text" }]
        put.set(textId(item.id), labelFor(shape, item.text, boxOf(shape)))
      }
    }
  }

  // Moving or resizing items: their labels, a frame's contents and the arrows that touch them follow.
  const moved = new Set<string>()
  for (const changeTo of edit.update ?? []) {
    const stored = current(changeTo.id)
    if (!stored || stored.containerId) fail(`The board has no item "${changeTo.id}".`)
    const item = stored!
    const frame = item.frameId ? current(item.frameId) : undefined
    const x = changeTo.x === undefined ? item.x : changeTo.x + (frame?.x ?? 0)
    const y = changeTo.y === undefined ? item.y : changeTo.y + (frame?.y ?? 0)
    const fields: Partial<BoardElement> = { x, y, customData: { ...item.customData, editedBy: author } }
    if (changeTo.w !== undefined && item.type !== "arrow") fields.width = changeTo.w
    if (changeTo.h !== undefined && item.type !== "arrow") fields.height = changeTo.h
    const kind = item.customData?.kind
    if (changeTo.color !== undefined) {
      const palette = PALETTE[changeTo.color]
      Object.assign(
        fields,
        kind === "note"
          ? { strokeColor: palette.fill, backgroundColor: palette.fill }
          : { strokeColor: palette.stroke },
      )
    }
    if (changeTo.text !== undefined) {
      if (isFrame(item)) fields.name = changeTo.text
      else if (item.type === "text")
        Object.assign(fields, {
          text: changeTo.text,
          originalText: changeTo.text,
          customData: { ...fields.customData, fit: true },
        })
      else if (item.type === "arrow" || item.type === "line" || item.type === "freedraw")
        fail(`"${changeTo.id}" is a ${item.type}, which holds no text.`)
    }
    const words = changeTo.text ?? textOf(board, item)
    if ((item.type === "rectangle" || item.type === "ellipse" || item.type === "diamond") && words) {
      const w = fields.width ?? item.width
      const minimum = kind === "note" ? NOTE : (changeTo.h ?? item.height)
      if (changeTo.text !== undefined || changeTo.w !== undefined || changeTo.h !== undefined)
        fields.height = minimum + labelGrowth(words, w, minimum)
    }
    if (item.type === "text" && (changeTo.text !== undefined || changeTo.w !== undefined) && changeTo.h === undefined)
      fields.height = textHeight(words, fields.width ?? item.width)
    change(item.id, fields)
    const now = current(item.id)!
    // The label: new words, and centered in the shape again.
    if (!isFrame(item) && item.type !== "text" && item.type !== "arrow") {
      const bound = item.boundElements?.find((b) => b.type === "text")?.id
      if (words) {
        const fresh = labelFor(now, words, boxOf(now))
        const old = bound ? current(bound) : undefined
        // The label keeps its own font and color; its words, place and size are new, and need measuring again.
        const { width, height, text, originalText } = fresh
        const at = { x: fresh.x, y: fresh.y }
        if (old)
          change(old.id, { ...at, width, height, text, originalText, customData: { ...old.customData, fit: true } })
        else {
          put.set(fresh.id, fresh)
          change(item.id, { boundElements: [...(now.boundElements ?? []), { id: fresh.id, type: "text" }] })
        }
      }
    }
    const dx = now.x - item.x
    const dy = now.y - item.y
    if (isFrame(item) && (dx || dy))
      for (const child of live(board))
        if (child.frameId === item.id) {
          change(child.id, { x: child.x + dx, y: child.y + dy })
          moved.add(child.id)
        }
    moved.add(item.id)
  }

  for (const edge of edit.edges ?? []) {
    const from = current(edge.from)
    const to = current(edge.to)
    if (!from) fail(`An edge starts at "${edge.from}", which isn't on the board.`)
    if (!to) fail(`An edge ends at "${edge.to}", which isn't on the board.`)
    const id = `arrow-${random().toString(36)}`
    const path = arrowPath(from!, to!)
    const arrow = makeElement({ id, type: "arrow", customData: meta, roundness: { type: 2 } })
    Object.assign(arrow, path, {
      startBinding: { elementId: from!.id, focus: 0, gap: 8 },
      endBinding: { elementId: to!.id, focus: 0, gap: 8 },
      startArrowhead: null,
      endArrowhead: "arrow",
      elbowed: false,
      lastCommittedPoint: null,
    })
    put.set(id, arrow)
    for (const end of [from!, to!])
      change(end.id, { boundElements: [...(current(end.id)!.boundElements ?? []), { id, type: "arrow" }] })
    if (edge.label) {
      arrow.boundElements = [{ id: textId(id), type: "text" }]
      const [, [dx, dy]] = path.points
      const box = { x: path.x + dx / 2 - 100, y: path.y + dy / 2 - 20, w: 200, h: 40 }
      put.set(textId(id), labelFor(arrow, edge.label, box))
    }
  }

  // Arrows follow what they connect when it moved.
  for (const arrow of live(board).filter((element) => element.type === "arrow")) {
    const a = arrow.startBinding?.elementId
    const b = arrow.endBinding?.elementId
    if (!a || !b || (!moved.has(a) && !moved.has(b))) continue
    const from = current(a)
    const to = current(b)
    if (from && to) change(arrow.id, arrowPath(from, to))
  }

  for (const ref of edit.remove ?? []) {
    const stored = current(ref)
    if (!stored || stored.containerId) fail(`The board has no item "${ref}".`)
    const doomed = new Set([ref])
    for (const element of live(board)) if (element.frameId === ref) doomed.add(element.id)
    // An arrow bound to a deleted item would point at nothing, so it goes too.
    for (const element of live(board))
      if (
        element.type === "arrow" &&
        (doomed.has(element.startBinding?.elementId ?? "") || doomed.has(element.endBinding?.elementId ?? ""))
      )
        doomed.add(element.id)
    // Labels go with what holds them.
    for (const element of live(board))
      if (element.containerId && doomed.has(element.containerId)) doomed.add(element.id)
    for (const id of doomed) {
      if (put.has(id) && !board.elements.some((element) => element.id === id)) put.delete(id)
      else change(id, { isDeleted: true })
    }
  }

  // New elements stack above everything on the board, in the order they were made, each label right above its shape.
  const placed = [...put.values()].filter((element) => !board.elements.some((stored) => stored.id === element.id))
  const top = board.elements
    .map((element) => element.index)
    .filter((index): index is string => Boolean(index))
    .sort()
    .at(-1)
  const keys = generateNKeysBetween(top ?? null, null, placed.length)
  placed.forEach((element, i) => (element.index = keys[i]))
  return { put: [...put.values()] }
}

/** An arrow's place and points from one item's edge to the other's. */
function arrowPath(from: BoardElement, to: BoardElement) {
  const start = edgePoint(boxOf(from), boxOf(to))
  const end = edgePoint(boxOf(to), boxOf(from))
  const dx = end.x - start.x || 1
  const dy = end.y - start.y
  // SAFETY: the array contains exactly the two numeric points constructed below.
  const points = [
    [0, 0],
    [dx, dy],
  ] as [[number, number], [number, number]]
  return {
    x: start.x,
    y: start.y,
    width: Math.abs(dx),
    height: Math.abs(dy),
    points,
  }
}

/** Applies an agent's changes (boardChanges) to a board in place. */
export function applyChanges(board: Board, put: BoardElement[]) {
  mergeElements(board, put)
  return board
}

function contentBottom(board: Board) {
  const top = items(board).filter((element) => !element.frameId && element.type !== "arrow")
  if (!top.length) return 0
  return Math.max(...top.map((element) => element.y + element.height)) + GAP * 2
}

/** A frame on the board, for the per-frame images agents look at. */
export function boardFrames(board: Board) {
  return items(board)
    .filter(isFrame)
    .map((frame) => ({ id: frame.id, name: textOf(board, frame) || "Untitled frame" }))
}

const round = (n: number) => Math.round(n)
const byPlace = (a: BoardElement, b: BoardElement) => a.y - b.y || a.x - b.x

/**
 * The board as text for agents: each frame with what's in it, then everything outside frames. Every line names the
 * item's id (for edges, update and remove), its words, where it is, and who added it. Arrows read `a → b`; freehand
 * drawings only say where they are, since their meaning is in the frame's image.
 */
export function boardOutline(board: Board) {
  const all = items(board)
  const byId = new Map(all.map((element) => [element.id, element]))
  const name = (id?: string) => {
    const item = id ? byId.get(id) : undefined
    if (!item) return "nothing"
    const text = textOf(board, item)
    return text ? `${item.id} "${clip(text, 40)}"` : item.id
  }
  const line = (item: BoardElement, depth: number): string => {
    const by = item.customData?.author ? ` by ${item.customData.author}` : ""
    const at = `(${round(item.x)},${round(item.y)}${item.width ? ` ${round(item.width)}×${round(item.height)}` : ""})`
    const text = textOf(board, item)
    let head: string
    if (item.type === "arrow") {
      const label = text ? ` "${clip(text, 60)}"` : ""
      head = `arrow ${item.id}: ${name(item.startBinding?.elementId)} → ${name(item.endBinding?.elementId)}${label}${by}`
    } else if (isFrame(item)) {
      head = `frame ${item.id} "${text || "Untitled frame"}" ${at}${by}`
    } else {
      const kind = item.customData?.kind === "note" ? "note" : item.type === "freedraw" ? "drawing" : item.type
      head = `${kind} ${item.id}${text ? ` "${clip(text, 400)}"` : ""} ${at}${by}`
    }
    return "  ".repeat(depth) + head
  }
  const shapes = all.filter((item) => item.type !== "arrow")
  const frames = shapes.filter(isFrame).sort(byPlace)
  const inFrame = new Set(frames.map((frame) => frame.id))
  const loose = shapes.filter((item) => !isFrame(item) && !(item.frameId && inFrame.has(item.frameId))).sort(byPlace)
  const links = all.filter((item) => item.type === "arrow")
  const parts = frames.map((frame) =>
    [
      line(frame, 0),
      ...shapes
        .filter((item) => item.frameId === frame.id)
        .sort(byPlace)
        .map((item) => line(item, 1)),
    ].join("\n"),
  )
  if (loose.length) parts.push(["Outside frames:", ...loose.map((item) => line(item, 1))].join("\n"))
  if (links.length) parts.push(["Arrows:", ...links.map((item) => line(item, 1))].join("\n"))
  return parts.join("\n\n") || "The board is empty."
}

/** The board's words, for search. */
export const boardText = (board: Board) =>
  live(board)
    .map((each) => (isFrame(each) ? (each.name ?? "") : (each.originalText ?? each.text ?? "")))
    .filter(Boolean)
    .join("\n")

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ")
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
