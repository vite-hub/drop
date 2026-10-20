import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { applyChanges, boardChanges, boardOutline, emptyBoard, labelGrowth, parseBoard } from "../../shared/board.ts"

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

test("a note or box grows down to hold its words, and a frame's grid makes room for it", () => {
  const long =
    "CAUSA: con pnpm son dependencias de @antfu/eslint-config, no de tu proyecto. Dos nombres mal adivinados: @eslint/markdown y @eslint-community/eslint-plugin-eslint-comments"
  assert.equal(labelGrowth("Sign up", 200, 200), 0)
  // About seven lines of small sans type: the note grows by most of its own height.
  assert.ok(labelGrowth(long, 200, 200) > 100)
  // A wider box needs fewer lines than a note.
  assert.ok(labelGrowth(long, 300, 200) < labelGrowth(long, 200, 200))

  const board = applyChanges(
    emptyBoard(),
    ...Object.values(
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
      ),
    ),
  )
  const grown = 200 + labelGrowth(long, 200, 200)
  const outline = boardOutline(board)
  assert.match(outline, new RegExp(`note b ".*" \\(280,60 200×${grown}\\)`))
  // The second row starts below the tallest note of the first, and the frame holds both rows.
  assert.match(outline, new RegExp(`note e "below" \\(40,${60 + grown + 40} 200×200\\)`))
  assert.match(outline, new RegExp(`frame f "Trap 2" \\(0,0 1000×${grown + 200 + 3 * 40 + 40}\\)`))
  assert.match(outline, new RegExp(`rectangle box ".*" \\(\\d+,\\d+ 300×${100 + labelGrowth(long, 300, 100)}\\)`))

  // New words get a new size.
  const { put } = boardChanges(board, { update: [{ id: "b", text: "short" }] }, "Claude")
  assert.equal(put[0].props.growY, 0)
})
