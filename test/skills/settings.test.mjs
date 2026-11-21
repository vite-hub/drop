import assert from "node:assert/strict"
import { H3Event } from "h3"
import { afterEach, test, vi } from "vite-plus/test"
import { migrations } from "../../scripts/migrations.mjs"
import { sql, state } from "../cost/harness.mjs"

const all = migrations()
const latest = all.findIndex((migration) => migration.name === "0019_skill_settings_updated_by.sql")
for (const migration of all.slice(0, latest)) sql.exec(migration.sql)
sql.exec(`
  INSERT INTO skill_settings (name, enabled, updated_at, updated_by) VALUES
    ('pr-evidence', 0, 100, 'admin-1'),
    ('prototype', 1, 200, 'admin-2');
`)
for (const migration of all.slice(latest)) sql.exec(migration.sql)

const { default: settings } = await import("../../server/skills.ts")
const { default: catalog } = await import("../../server/api/skills/index.get.ts")
const { default: patch } = await import("../../server/api/skills/[name].patch.ts")

const rows = () =>
  sql
    .prepare("SELECT name, enabled, updated_by FROM skill_settings ORDER BY name")
    .all()
    .map((row) => ({ ...row }))
const offNames = async () => {
  const [error, states] = await settings.list()
  assert.equal(error, undefined)
  return states.filter((entry) => !entry.enabled).map((entry) => entry.skill.name)
}
let now = Date.now()
const later = () => {
  now += 60_001
  vi.spyOn(Date, "now").mockReturnValue(now)
}
const asks = (who) => {
  state.who = who
  return catalog(new H3Event(new Request("https://drop.example/api/skills")))
}

afterEach(() => {
  vi.restoreAllMocks()
  state.who = null
})

test("migration 0019 keeps every skill_settings row and lets updated_by be empty", async () => {
  assert.deepEqual(rows(), [
    { name: "pr-evidence", enabled: 0, updated_by: "admin-1" },
    { name: "prototype", enabled: 1, updated_by: "admin-2" },
  ])
  assert.deepEqual(await offNames(), ["pr-evidence"])
  assert.equal(
    (await settings.enabled()).some((skill) => skill.name === "pr-evidence"),
    false,
  )
  assert.equal(
    sql.prepare("SELECT \"notnull\" FROM pragma_table_info('skill_settings') WHERE name = 'updated_by'").get().notnull,
    0,
  )
})

test("turning skills off and on writes the table, and a later read finds the same switches", async () => {
  assert.deepEqual(await settings.set("prototype", false), [
    undefined,
    { enabled: false, skill: settings.skills.find((skill) => skill.name === "prototype") },
  ])
  assert.deepEqual(rows(), [
    { name: "pr-evidence", enabled: 0, updated_by: "admin-1" },
    { name: "prototype", enabled: 0, updated_by: null },
  ])
  await settings.set("slidev", false)
  later()
  assert.deepEqual(await offNames(), ["pr-evidence", "prototype", "slidev"])

  await settings.set("pr-evidence", true)
  await settings.set("prototype", true)
  assert.deepEqual(rows(), [
    { name: "pr-evidence", enabled: 1, updated_by: null },
    { name: "prototype", enabled: 1, updated_by: null },
    { name: "slidev", enabled: 0, updated_by: null },
  ])
  await settings.set("slidev", true)
  assert.deepEqual(
    rows().map((row) => row.enabled),
    [1, 1, 1],
  )
  later()
  assert.deepEqual(await offNames(), [])
  assert.equal((await settings.set("no-such-skill", false))[0].code, "SKILL_NOT_FOUND")
})

test("members see only skills that are on, and admins see every skill with its switch", async () => {
  await settings.set("prototype", false)
  try {
    const member = await asks({ role: "member" })
    assert.equal(
      member.some((entry) => entry.name === "prototype"),
      false,
    )
    assert.ok(member.every((entry) => entry.enabled))
    const admin = await asks({ role: "admin" })
    assert.deepEqual(
      admin.map((entry) => entry.name),
      settings.skills.map((skill) => skill.name),
    )
    assert.equal(admin.find((entry) => entry.name === "prototype").enabled, false)
  } finally {
    await settings.set("prototype", true)
  }
})

test("the admin route turns a skill off and answers 404 for an unknown skill", async () => {
  const request = (name, enabled) => {
    const event = new H3Event(
      new Request(`https://drop.example/api/skills/${name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      }),
    )
    event.context.params = { name }
    event.context.log = { set() {}, error() {}, info() {} }
    return patch(event)
  }
  state.who = { role: "admin", actorKind: "browser", userId: "admin-1", name: "Admin", email: "admin@example.com" }
  assert.deepEqual(await request("prototype", false), { ok: true })
  assert.deepEqual(await offNames(), ["prototype"])
  assert.deepEqual(await request("prototype", true), { ok: true })
  await assert.rejects(request("no-such-skill", false), (error) => error.status === 404)
})

test("another instance's change shows within a minute, and a failed read is not kept", async () => {
  sql.exec("UPDATE skill_settings SET enabled = 0 WHERE name = 'slidev'")
  assert.deepEqual(await offNames(), [])
  later()
  assert.deepEqual(await offNames(), ["slidev"])

  sql.exec("ALTER TABLE skill_settings RENAME TO skill_settings_away")
  try {
    later()
    await assert.rejects(settings.enabled(), (error) => error.code === "SKILL_SETTINGS_UNAVAILABLE")
    const [error] = await settings.set("slidev", true)
    assert.equal(error.code, "SKILL_SETTINGS_UNAVAILABLE")
  } finally {
    sql.exec("ALTER TABLE skill_settings_away RENAME TO skill_settings")
  }
  assert.deepEqual(await offNames(), ["slidev"])
  await settings.set("slidev", true)
  assert.deepEqual(await offNames(), [])
})
