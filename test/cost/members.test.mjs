import assert from "node:assert/strict"
import { test } from "node:test"
import { event, insertDrop, migrate, reset, sql, state, who } from "./harness.mjs"

migrate()
reset()

test("members counts the drops each person lists, and last activity per person in one query, past D1's 100 bound parameters", async () => {
  for (let i = 0; i < 150; i++) sql.prepare("INSERT INTO user (id, name, email, created_at) VALUES (?, ?, ?, ?)").run(`u${i}`, `U${i}`, `u${i}@example.com`, i + 10)
  insertDrop("d1")
  insertDrop("d2")
  // Not drops of their own: an older version, a folder (d2 sits in it), a file a doc embeds, and one in the Trash.
  insertDrop("d1v2", { supersedes_id: "d1", version: 2 })
  insertDrop("folder", { kind: "folder", blob_key: null })
  sql.prepare("UPDATE drops SET parent_id = 'folder' WHERE id = 'd2'").run()
  insertDrop("image", { kind: "image", parent_id: "d1v2" })
  insertDrop("gone", { trashed_at: 5 })
  sql.prepare("INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id) VALUES ('s', 9, 't', 1, 1700000000000, 'owner')").run()
  state.who = who
  const { default: handler } = await import("../../server/api/members/index.get.ts")
  const members = await handler(event("/api/members"))
  assert.equal(members.length, 151)
  assert.deepEqual(members.filter(member => member.drops).map(member => [member.id, member.drops]), [["owner", 2]])
  assert.equal(members.find(member => member.id === "owner").lastActiveAt, 1700000000000)
  assert.equal(members.find(member => member.id === "u3").lastActiveAt, null)
  assert.equal(members.find(member => member.id === "u3").email, null, "only admins see other people's emails")
})
