import assert from "node:assert/strict"
import { test } from "node:test"
import { event, insertDrop, migrate, reset, sql, state, who } from "./harness.mjs"

migrate()
reset()

test("members counts drops and last activity per person in one query, past D1's 100 bound parameters", async () => {
  for (let i = 0; i < 150; i++) sql.prepare("INSERT INTO user (id, name, email, created_at) VALUES (?, ?, ?, ?)").run(`u${i}`, `U${i}`, `u${i}@example.com`, i + 10)
  insertDrop("d1")
  insertDrop("d2")
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
