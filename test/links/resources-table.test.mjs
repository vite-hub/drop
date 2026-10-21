import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { sql, migrate, reset } from "../cost/harness.mjs"
const { resourcesOf, saveResources } = await import("../../server/utils/resources.ts")

migrate()
reset()
// A database from before links existed, like production's until a drop first needs them.
sql.exec("DROP TRIGGER drop_resources_drop_delete; DROP TABLE drop_resources")

test("a database without the links table gets it on the first read, trigger included", async () => {
  const doc = { id: "doc", link: "doc" }
  assert.deepEqual(await resourcesOf(doc), [])
  await saveResources(doc, [{ url: "https://github.com/acme/app/pull/1", title: "PR #1" }])
  assert.deepEqual(await resourcesOf(doc), [{ url: "https://github.com/acme/app/pull/1", title: "PR #1" }])
  const made = sql.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'drop_resources%' ORDER BY name").all()
  assert.deepEqual(
    made.map((row) => row.name),
    ["drop_resources", "drop_resources_drop_delete"],
  )
})
