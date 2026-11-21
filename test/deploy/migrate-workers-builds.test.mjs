import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "vite-plus/test"
import { migrateWorkersBuild } from "../../scripts/migrate-workers-builds.mjs"
import { migrations } from "../../scripts/migrations.mjs"

const production = {
  WORKERS_CI: "1",
  WORKERS_CI_BRANCH: "main",
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  CLOUDFLARE_API_TOKEN: "deploy-token",
}

async function withWranglerConfig(databases, run) {
  const directory = await mkdtemp(join(tmpdir(), "drop-workers-builds-"))
  const configPath = join(directory, "wrangler.json")
  try {
    await writeFile(configPath, JSON.stringify({ d1_databases: databases }))
    await run(configPath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("previews and other hosts do not read the deploy config or migrate", async () => {
  await migrateWorkersBuild({ ...production, WORKERS_CI_BRANCH: "feat/pins" }, "/unused/wrangler.json")
  await migrateWorkersBuild({ ...production, WORKERS_CI: undefined }, "/unused/wrangler.json")
  await migrateWorkersBuild({ ...production, DROP_PRODUCTION_BRANCH: "prod" }, "/unused/wrangler.json")
})

test.each([
  ["template", { DROP_D1_MIGRATION_TOKEN: "migration-token" }, "migration-token"],
  [
    "build variable",
    { WORKERS_CI_BRANCH: "prod", DROP_PRODUCTION_BRANCH: "prod", CLOUDFLARE_D1_DATABASE_ID: "built-db" },
    "deploy-token",
  ],
])("applies pending migrations to the generated DB from the %s", async (_source, overrides, token) => {
  const previousFetch = globalThis.fetch
  const entries = migrations()
  const pending = entries.at(-1)
  const queries = []
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/test-account/d1/database/built-db/query")
      assert.equal(options.headers.Authorization, `Bearer ${token}`)
      const { sql } = JSON.parse(options.body)
      queries.push(sql)
      const results = sql.startsWith("SELECT") ? entries.slice(0, -1).map(({ name }) => ({ name })) : []
      return Response.json({ success: true, result: [{ success: true, results }] })
    }
    await withWranglerConfig(
      [
        { binding: "OTHER", database_id: "other-db" },
        { binding: "DB", database_id: "built-db" },
      ],
      (configPath) => migrateWorkersBuild({ ...production, ...overrides }, configPath),
    )
    assert.equal(queries.length, 3)
    assert.match(queries[0], /^CREATE TABLE IF NOT EXISTS d1_migrations/)
    assert.equal(queries[1], "SELECT name FROM d1_migrations")
    assert.ok(queries[2].includes(`VALUES ('${pending.name}')`))
  } finally {
    globalThis.fetch = previousFetch
  }
})

test.each([{ databases: [] }, { databases: [{ binding: "DB", database_id: "00000000-0000-4000-8000-000000000000" }] }])(
  "production fails instead of skipping when the generated DB has no real ID (%j)",
  async ({ databases }) => {
    await withWranglerConfig(databases, (configPath) =>
      assert.rejects(
        migrateWorkersBuild({ ...production, CLOUDFLARE_D1_DATABASE_ID: "unbound-db" }, configPath),
        /No deployed D1 database ID for DB/,
      ),
    )
  },
)

test("production with no token fails with setup instructions", async () => {
  await withWranglerConfig([{ binding: "DB", database_id: "built-db" }], (configPath) =>
    assert.rejects(
      migrateWorkersBuild({ ...production, CLOUDFLARE_API_TOKEN: undefined }, configPath),
      /DROP_D1_MIGRATION_TOKEN.*D1 Write/,
    ),
  )
})

test("a deploy-only token rejected by D1 fails with setup instructions", async () => {
  const previousFetch = globalThis.fetch
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.headers.Authorization, "Bearer deploy-token")
      return Response.json({ success: false, errors: [{ message: "Permission denied" }] }, { status: 403 })
    }
    await withWranglerConfig([{ binding: "DB", database_id: "built-db" }], (configPath) =>
      assert.rejects(migrateWorkersBuild(production, configPath), (error) => {
        assert.match(error.message, /DROP_D1_MIGRATION_TOKEN.*D1 Write/)
        assert.match(error.cause.message, /403.*Permission denied/)
        return true
      }),
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})
