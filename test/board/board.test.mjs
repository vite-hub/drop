import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { applyChanges, boardChanges, boardOutline, emptyBoard, parseBoard } from "../../shared/board.ts"

const flow = {
  add: [
    { id: "flow", type: "frame", text: "Onboarding flow" },
    { id: "signup", type: "note", text: "Sign up", in: "flow" },
    { id: "team", type: "note", text: "Pick a team", in: "flow" },
    { id: "idea", type: "text", text: "Skip the team step for solo users?" },
  ],
  edges: [{ from: "signup", to: "team", label: "invite?" }],
}

test("an agent's items become tldraw records the schema accepts, and read back as an outline", () => {
  const board = emptyBoard()
  const { put, remove } = boardChanges(board, flow, "Claude")
  assert.equal(remove.length, 0)
  // Four items, one arrow, two bindings.
  assert.equal(put.length, 7)
  applyChanges(board, put, remove)
  const outline = boardOutline(board)
  assert.match(outline, /^frame flow "Onboarding flow" \(0,0 520×320\) by Claude/)
  assert.match(outline, /  note signup "Sign up" \(40,60 200×200\) by Claude/)
  assert.match(outline, /Arrows:\n  arrow \S+: signup "Sign up" → team "Pick a team" "invite\?" by Claude/)
  assert.match(outline, /Outside frames:\n  text idea "Skip the team step for solo users\?"/)
  // What the server stores loads back through tldraw's migrations unchanged.
  assert.deepEqual(parseBoard(JSON.stringify(board)).store, board.store)
})

test("removing a frame removes what's in it and the arrows between them", () => {
  const board = applyChanges(emptyBoard(), ...Object.values(boardChanges(emptyBoard(), flow, "Claude")))
  const { remove } = boardChanges(board, { remove: ["flow"] }, "Claude")
  const shapes = remove.filter((id) => id.startsWith("shape:"))
  assert.equal(shapes.length, 4)
  assert.equal(remove.filter((id) => id.startsWith("binding:")).length, 2)
})

test("bad input names the item", () => {
  assert.throws(() => boardChanges(emptyBoard(), { add: [{ id: "a", type: "note", in: "nope" }] }, "x"), /"nope"/)
  assert.throws(() => boardChanges(emptyBoard(), { edges: [{ from: "a", to: "b" }] }, "x"), /"a"/)
  assert.throws(() => boardChanges(emptyBoard(), { add: [{ id: "a b", type: "note" }] }, "x"), /letters, digits/)
})
