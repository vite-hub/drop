import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { test } from "node:test"
import { migrateD1 } from "../../scripts/migrate-d1.mjs"

const settings = { CLOUDFLARE_ACCOUNT_ID: "test-account", CLOUDFLARE_API_TOKEN: "test-token", CLOUDFLARE_D1_DATABASE_ID: "test-database" }

test("migrations create Drop's schema once and share Wrangler's ledger", async () => {
  const previousFetch = globalThis.fetch
  const previousEnv = { ...process.env }
  const database = new DatabaseSync(":memory:")
  let migrations = 0
  try {
    Object.assign(process.env, settings)
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/test-account/d1/database/test-database/query")
      assert.equal(options.headers.Authorization, "Bearer test-token")
      const { sql } = JSON.parse(options.body)
      if (sql.startsWith("SELECT")) return Response.json({ success: true, result: [{ success: true, results: database.prepare(sql).all() }] })
      if (sql.includes("INSERT INTO d1_migrations")) migrations++
      database.exec(`BEGIN; ${sql}; COMMIT;`)
      return Response.json({ success: true, result: [{ success: true, results: [] }] })
    }
    await migrateD1()
    assert.equal(migrations, 3)
    assert.equal(database.prepare("SELECT count(*) AS count FROM d1_migrations").get().count, 3)
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'drops'").get())
    await migrateD1()
    assert.equal(migrations, 3)
  }
  finally {
    globalThis.fetch = previousFetch
    process.env = previousEnv
    database.close()
  }
})

test("missing credentials and D1 errors stop migrations", async () => {
  const previousFetch = globalThis.fetch
  const previousEnv = { ...process.env }
  try {
    Object.assign(process.env, settings)
    delete process.env.CLOUDFLARE_D1_DATABASE_ID
    await assert.rejects(migrateD1(), /CLOUDFLARE_D1_DATABASE_ID is required/)
    Object.assign(process.env, settings)
    globalThis.fetch = async () => Response.json({ success: false, errors: [{ message: "Database unavailable" }] }, { status: 503 })
    await assert.rejects(migrateD1(), /D1 migration failed \(503\): Database unavailable/)
  }
  finally {
    globalThis.fetch = previousFetch
    process.env = previousEnv
  }
})
