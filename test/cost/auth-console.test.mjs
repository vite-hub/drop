import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { insertDrop, insertVersion, migrate, queries, reset, sql } from "./harness.mjs"

const { countDropsByUser } = await import("../../server/utils/auth-console.ts")

migrate()
beforeEach(() => reset())

test("Console drop counts use one query and one bind past D1's 100-parameter limit", async () => {
  const ids = ["owner", ...Array.from({ length: 150 }, (_, i) => `u${i}`)]
  for (const id of ids.slice(1))
    sql.prepare("INSERT INTO user (id, name, email) VALUES (?, ?, ?)").run(id, id, `${id}@example.com`)
  insertDrop("d1", { version: 2 })
  insertVersion("d1", 1)
  insertDrop("d2")
  insertDrop("folder", { kind: "folder", blob_key: null })
  sql.prepare("UPDATE drops SET parent_id = 'folder' WHERE id = 'd2'").run()
  insertDrop("image", { kind: "image", parent_id: "d1" })
  insertDrop("gone", { trashed_at: 5 })
  queries.length = 0
  const counts = await countDropsByUser(ids)
  assert.equal(Object.keys(counts).length, 151)
  assert.equal(counts.owner, 2)
  assert.equal(counts.u3, 0)
  assert.equal(queries.length, 1)
  assert.equal(queries[0].params.length, 1)
  assert.deepEqual(await countDropsByUser(["u3"]), { u3: 0 }, "Only requested users")
  queries.length = 0
  assert.deepEqual(await countDropsByUser([]), {})
  assert.equal(queries.length, 0)
})
