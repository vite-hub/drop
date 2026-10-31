import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { sql, migrate, reset, insertDrop } from "../cost/harness.mjs"
const { peeksOf, PEEK_INSIDE, PEEK_TEXT } = await import("../../server/utils/drops/peeks.ts")

migrate()
beforeEach(() => {
  reset()
  sql.prepare("INSERT INTO user (id, name, email) VALUES ('mate', 'Mate', 'mate@example.com')").run()
})
const text = (id, words) => sql.prepare("INSERT INTO drop_texts (drop_id, text) VALUES (?, ?)").run(id, words)

test("a doc peeks with its first words, an image with its file, a folder with its newest drops", async () => {
  insertDrop("doc")
  text("doc", "w".repeat(1000))
  insertDrop("shot", { kind: "image", filename: "shot.png", blob_key: "shot.png" })
  insertDrop("box", { kind: "folder", blob_key: null })
  for (let n = 1; n <= 5; n++) insertDrop(`in${n}`, { parent_id: "box", updated_at: n })
  text("in5", "[!NOTE] Newest inside")
  insertDrop("gone", { parent_id: "box", updated_at: 99, trashed_at: 50 })

  const peeks = await peeksOf("owner", ["doc", "shot", "box"])
  assert.equal(peeks.doc.text.length, PEEK_TEXT)
  assert.equal(peeks.shot.thumbnail, "/f/shot.png")
  assert.deepEqual(
    peeks.box.inside.map((child) => child.id),
    ["in5", "in4", "in3"].slice(0, PEEK_INSIDE),
    "newest first, the Trash left out",
  )
  assert.equal(peeks.box.inside[0].text, "Newest inside")
})

test("only the caller's own drops peek, and nothing changes when they do", async () => {
  insertDrop("mine", { last_accessed_at: 5 })
  insertDrop("theirs", { owner_id: "mate" })
  text("theirs", "Private words")
  const peeks = await peeksOf("owner", ["mine", "theirs", "missing"])
  assert.deepEqual(Object.keys(peeks), ["mine"])
  const row = sql.prepare("SELECT last_accessed_at FROM drops WHERE id = 'mine'").get()
  assert.equal(row.last_accessed_at, 5, "a peek doesn't count as opening the drop")
})
