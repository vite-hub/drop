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
  insertDrop("held", { parent_id: "box", updated_at: 100, quarantined_at: 50 })

  const peeks = await peeksOf("owner", ["doc", "shot", "box"])
  assert.equal(peeks.doc.text.length, PEEK_TEXT)
  assert.equal(peeks.shot.thumbnail, "/f/shot.png")
  assert.deepEqual(
    peeks.box.inside.map((child) => child.id),
    ["in5", "in4", "in3"].slice(0, PEEK_INSIDE),
    "newest first, Trash and quarantined drops left out before ranking",
  )
  assert.equal(peeks.box.inside[0].text, "Newest inside")
})

test("quarantined drops never expose preview fields, even to their owner", async () => {
  insertDrop("doc", { quarantined_at: 50 })
  text("doc", "Held words")
  insertDrop("shot", { kind: "image", blob_key: "held.png", quarantined_at: 50 })
  insertDrop("box", { kind: "folder", blob_key: null, quarantined_at: 50 })
  insertDrop("inside", { parent_id: "box" })

  assert.deepEqual(await peeksOf("owner", ["doc", "shot", "box"]), {})
})

test("quarantine is inherited through folders, including another owner's team folder", async () => {
  insertDrop("held", { kind: "folder", quarantined_at: 50 })
  insertDrop("box", { kind: "folder", parent_id: "held" })
  insertDrop("doc", { parent_id: "box" })
  text("doc", "Held descendant's words")
  insertDrop("team", { kind: "folder", team_folder: 1, owner_id: "mate", quarantined_at: 50 })
  insertDrop("nested", { kind: "folder", parent_id: "team" })
  insertDrop("shot", { kind: "image", parent_id: "nested", blob_key: "held.png" })

  assert.deepEqual(await peeksOf("owner", ["box", "doc", "nested", "shot"]), {})

  sql.prepare("UPDATE drops SET quarantined_at = NULL WHERE id IN ('held', 'team')").run()
  const visible = await peeksOf("owner", ["box", "doc", "nested", "shot"])
  assert.equal(visible.doc.text, "Held descendant's words")
  assert.equal(visible.shot.thumbnail, "/f/held.png")
  assert.deepEqual(
    visible.nested.inside.map((child) => child.id),
    ["shot"],
  )
})

test("folder peeks also keep the caller's owner scope", async () => {
  insertDrop("team", { kind: "folder", team_folder: 1 })
  insertDrop("mine", { parent_id: "team", updated_at: 1 })
  insertDrop("theirs", { parent_id: "team", owner_id: "mate", share: "private", updated_at: 2 })
  text("theirs", "Someone else's words")

  const peeks = await peeksOf("owner", ["team"])
  assert.deepEqual(
    peeks.team.inside.map((child) => child.id),
    ["mine"],
  )
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
