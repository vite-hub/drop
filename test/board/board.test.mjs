import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import {
  applyChanges,
  boardChanges,
  boardOutline,
  emptyBoard,
  labelGrowth,
  mergeElements,
  parseBoard,
  serializeBoard,
} from "../../shared/board.ts"

const flow = {
  add: [
    { id: "flow", type: "frame", text: "Onboarding flow" },
    { id: "signup", type: "note", text: "Sign up", in: "flow" },
    { id: "team", type: "note", text: "Pick a team", in: "flow" },
    { id: "idea", type: "text", text: "Skip the team step for solo users?" },
  ],
  edges: [{ from: "signup", to: "team", label: "invite?" }],
}
const made = () => applyChanges(emptyBoard(), boardChanges(emptyBoard(), flow, "Claude").put)
const byId = (board, id) => board.elements.find((element) => element.id === id)

test("an agent's items become Excalidraw elements, and read back as an outline", () => {
  const board = made()
  // Four items, one arrow, and the labels of two notes and the arrow.
  assert.equal(board.elements.length, 8)
  const outline = boardOutline(board)
  assert.match(outline, /^frame flow "Onboarding flow" \(0,0 520×320\) by Claude/)
  assert.match(outline, / {2}note signup "Sign up" \(40,60 200×200\) by Claude/)
  assert.match(outline, /Arrows:\n {2}arrow \S+: signup "Sign up" → team "Pick a team" "invite\?" by Claude/)
  assert.match(outline, /Outside frames:\n {2}text idea "Skip the team step for solo users\?"/)
  // Items in a frame belong to it, and a note's label is bound to it both ways.
  assert.equal(byId(board, "signup").frameId, "flow")
  assert.equal(byId(board, "signup:text").containerId, "signup")
  assert.deepEqual(
    byId(board, "signup").boundElements.map((bound) => bound.type),
    ["text", "arrow"],
  )
  // New elements stack in the order they were made.
  const indices = board.elements.map((element) => element.index)
  assert.deepEqual(indices, [...indices].sort())
})

test("a board is stored as an .excalidraw file that reads back the same, without images or embeds", () => {
  const board = made()
  const file = JSON.parse(serializeBoard(board))
  // What excalidraw.com's Open checks: the type, and the elements as a list.
  assert.equal(file.type, "excalidraw")
  assert.equal(file.elements.length, board.elements.length)
  assert.deepEqual(parseBoard(serializeBoard(board)).elements, board.elements)
  file.elements.push({ ...file.elements[1], id: "picture", type: "image", fileId: "x" })
  assert.equal(parseBoard(JSON.stringify(file)).elements.length, board.elements.length)
  assert.throws(() => parseBoard(JSON.stringify({ tldrawFileFormatVersion: 1, records: [] })), /Not a board/)
})

test("merging keeps the higher version of each element, and who added it", () => {
  const board = made()
  const note = byId(board, "signup")
  // A person moves the note: a higher version wins, and the note still says Claude added it.
  mergeElements(board, [{ ...note, x: 500, version: note.version + 1, customData: {} }], "Ana")
  assert.equal(byId(board, "signup").x, 500)
  assert.equal(byId(board, "signup").customData.author, "Claude")
  // A stale copy from a browser that missed the move loses.
  assert.equal(mergeElements(board, [{ ...note, x: 0 }], "Ana"), 0)
  assert.equal(byId(board, "signup").x, 500)
  // Something new a person drew is theirs.
  mergeElements(board, [{ ...note, id: "sketch", type: "freedraw", customData: undefined }], "Ana")
  assert.match(boardOutline(board), /drawing sketch .* by Ana/)
})

test("removing a frame deletes what's in it and the arrows between them, as tombstones every board merges", () => {
  const board = made()
  const { put } = boardChanges(board, { remove: ["flow"] }, "Claude")
  // The frame, two notes, their labels, the arrow and its label.
  assert.equal(put.length, 7)
  assert.ok(put.every((element) => element.isDeleted && element.version === 2))
  applyChanges(board, put)
  assert.doesNotMatch(boardOutline(board), /flow|signup|arrow/)
  assert.match(boardOutline(board), /text idea/)
})

test("bad input names the item", () => {
  assert.throws(() => boardChanges(emptyBoard(), { add: [{ id: "a", type: "note", in: "nope" }] }, "x"), /"nope"/)
  assert.throws(() => boardChanges(emptyBoard(), { edges: [{ from: "a", to: "b" }] }, "x"), /"a"/)
  assert.throws(() => boardChanges(emptyBoard(), { add: [{ id: "a b", type: "note" }] }, "x"), /letters, digits/)
  assert.throws(() => boardChanges(made(), { add: [{ id: "idea", type: "note" }] }, "x"), /already has an item "idea"/)
})

test("a note or box grows down to hold its words, and a frame's grid makes room for it", () => {
  const long =
    "CAUSA: con pnpm son dependencias de @antfu/eslint-config, no de tu proyecto. Dos nombres mal adivinados: @eslint/markdown y @eslint-community/eslint-plugin-eslint-comments"
  assert.equal(labelGrowth("Sign up", 200, 200), 0)
  // Many lines of 16 px type: the note grows.
  assert.ok(labelGrowth(long, 200, 200) > 50)
  // A wider box needs fewer lines than a note.
  assert.ok(labelGrowth(long, 300, 100) < labelGrowth(long, 200, 100))

  const board = applyChanges(
    emptyBoard(),
    boardChanges(
      emptyBoard(),
      {
        add: [
          { id: "f", type: "frame", text: "Trap 2" },
          ...["a", "b", "c", "d"].map((id) => ({ id, type: "note", text: id === "b" ? long : id, in: "f" })),
          { id: "e", type: "note", text: "below", in: "f" },
          { id: "box", type: "box", text: long, w: 300, h: 100 },
        ],
      },
      "Claude",
    ).put,
  )
  const grown = 200 + labelGrowth(long, 200, 200)
  const outline = boardOutline(board)
  assert.match(outline, new RegExp(`note b ".*" \\(280,60 200×${grown}\\)`))
  // The second row starts below the tallest note of the first, and the frame holds both rows.
  assert.match(outline, new RegExp(`note e "below" \\(40,${60 + grown + 40} 200×200\\)`))
  assert.match(outline, new RegExp(`frame f "Trap 2" \\(0,0 1000×${grown + 200 + 3 * 40 + 40}\\)`))
  assert.match(outline, new RegExp(`rectangle box ".*" \\(\\d+,\\d+ 300×${100 + labelGrowth(long, 300, 100)}\\)`))

  // New words get a new size, and the label follows.
  const { put } = boardChanges(board, { update: [{ id: "b", text: "short" }] }, "Claude")
  assert.equal(put.find((element) => element.id === "b").height, 200)
  assert.equal(put.find((element) => element.id === "b:text").originalText, "short")
})

test("moving a frame moves what's in it, and arrows follow what they connect", () => {
  const board = made()
  const before = byId(board, "signup")
  const { put } = boardChanges(board, { update: [{ id: "flow", x: 1000, y: 0 }] }, "Claude")
  applyChanges(board, put)
  assert.equal(byId(board, "signup").x, before.x + 1000)
  assert.equal(byId(board, "signup:text").x - byId(board, "signup").x, before.width / 2 - 84)
  const arrow = board.elements.find((element) => element.type === "arrow")
  assert.ok(arrow.x > 1000, "the arrow starts at the moved note")
})
