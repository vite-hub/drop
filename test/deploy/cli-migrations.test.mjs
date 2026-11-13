import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "vite-plus/test"

const require = createRequire(import.meta.resolve("vite-hub"))
const { createDbCliContributor } = await import(pathToFileURL(require.resolve("@vite-hub/database/cli")))
const root = fileURLToPath(new URL("../../", import.meta.url))
// The Wrangler file name of each migration folder, the names D1's ledger already holds.
const names = JSON.parse(
  readFileSync(new URL("../../server/databases/default/migrations/d1-migrations.json", import.meta.url), "utf8"),
)

test("host deploy commands apply intentional destructive migrations on fresh D1 only once", async () => {
  const previousFetch = globalThis.fetch
  let database = new DatabaseSync(":memory:")
  let stderr = ""
  const context = {
    rootDir: root,
    env: { CLOUDFLARE_ACCOUNT_ID: "test-account", CLOUDFLARE_API_TOKEN: "test-token" },
    stdout: { write() {} },
    stderr: {
      write(value) {
        stderr += value
      },
    },
    spawn() {
      assert.fail("D1 HTTP migrations must not start Drizzle Kit")
    },
  }
  const contributor = createDbCliContributor({}, async () => ({
    rootDir: root,
    databaseNames: ["default"],
    databases: {
      default: {
        name: "default",
        dialect: "sqlite",
        migrationsDir: "server/databases/default/migrations",
        cloudflare: { http: true, databaseId: "test-database" },
      },
    },
  }))
  const migrate = contributor.namespaces[0].features.find((feature) => feature.name === "migrate")
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/test-account/d1/database/test-database/query")
      const { sql, params } = JSON.parse(options.body)
      let results = []
      if (sql.startsWith("SELECT")) results = database.prepare(sql).all(...params)
      else database.exec(`BEGIN; ${sql}; COMMIT;`)
      return Response.json({ success: true, result: [{ success: true, results }] })
    }
    // A fresh D1 has no rows to lose: ViteHub leaves out drops of tables that the same run created, so 0004's drop of
    // the old comment tables needs no flag there.
    assert.equal(await migrate.run([], context), 0, stderr)
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'drops'").get())

    const commands = [
      readFileSync(new URL("../../netlify.toml", import.meta.url), "utf8").match(/^command = "([^"]+)"/m)[1],
      JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")).buildCommand,
    ]
    for (const command of commands) {
      database.close()
      database = new DatabaseSync(":memory:")
      const args = command
        .match(/pnpm db:migrate\b(.*)$/)[1]
        .trim()
        .split(/\s+/)
        .filter(Boolean)
      assert.equal(await migrate.run(args, context), 0, stderr)
      assert.equal(await migrate.run(args, context), 0, stderr)
      assert.deepEqual(
        database
          .prepare("SELECT name FROM d1_migrations ORDER BY id")
          .all()
          .map((row) => row.name),
        Object.values(names).sort(),
      )
      assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE name = 'drops'").get())
      assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name = 'comments'").get(), undefined)
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
    }
  } finally {
    globalThis.fetch = previousFetch
    database.close()
  }
})
