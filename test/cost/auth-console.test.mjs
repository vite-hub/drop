import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { event, insertDrop, migrate, queries, reset, sql, state, who } from "./harness.mjs"

const { countDropsByUser } = await import("../../server/utils/auth-console.ts")
const { default: people } = await import("../../server/api/people.get.ts")

migrate()
beforeEach(() => reset())

test("Console drop counts use one query and one bind past D1's 100-parameter limit", async () => {
  const ids = ["owner", ...Array.from({ length: 150 }, (_, i) => `u${i}`)]
  for (const id of ids.slice(1))
    sql.prepare("INSERT INTO user (id, name, email) VALUES (?, ?, ?)").run(id, id, `${id}@example.com`)
  insertDrop("d1")
  insertDrop("d2")
  insertDrop("d1v2", { supersedes_id: "d1", version: 2 })
  insertDrop("folder", { kind: "folder", blob_key: null })
  sql.prepare("UPDATE drops SET parent_id = 'folder' WHERE id = 'd2'").run()
  insertDrop("image", { kind: "image", parent_id: "d1v2" })
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

test("editor suggestions require sign-in and return only public names and avatars, excluding banned users", async () => {
  await assert.rejects(people(event("/api/people")), { status: 401 })
  sql.exec("INSERT INTO user (id, name, email, banned) VALUES ('banned', 'Banned', 'banned@example.com', 1)")
  state.who = who
  const result = await people(event("/api/people"))
  assert.equal(result.length, 1)
  assert.equal(result[0].id, "owner")
  assert.deepEqual(Object.keys(result[0]).sort(), ["id", "image", "name"])
})
