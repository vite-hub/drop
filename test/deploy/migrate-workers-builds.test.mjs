import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "vite-plus/test"
import { migrateWorkersBuild } from "../../scripts/migrate-workers-builds.mjs"

const production = {
  WORKERS_CI: "1",
  WORKERS_CI_BRANCH: "main",
  DROP_PRODUCTION_BRANCH: "main",
  CLOUDFLARE_ACCOUNT_ID: "test-account",
  CLOUDFLARE_API_TOKEN: "deploy-token",
}

const noWrangler = () => assert.fail("Wrangler must not run")

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
  await migrateWorkersBuild({ ...production, WORKERS_CI_BRANCH: "feat/pins" }, "/unused/wrangler.json", noWrangler)
  await migrateWorkersBuild({ ...production, WORKERS_CI: undefined }, "/unused/wrangler.json", noWrangler)
  await migrateWorkersBuild({ ...production, DROP_PRODUCTION_BRANCH: "prod" }, "/unused/wrangler.json", noWrangler)
  await migrateWorkersBuild({ ...production, WORKERS_CI_BRANCH: undefined }, "/unused/wrangler.json", noWrangler)
  await migrateWorkersBuild(
    { ...production, WORKERS_CI_BRANCH: "", DROP_PRODUCTION_BRANCH: "" },
    "/unused/wrangler.json",
    noWrangler,
  )
})

test("a main Preview without the production opt-in never migrates its generated DB", async () => {
  await withWranglerConfig([{ binding: "DB", database_id: "built-db" }], (configPath) =>
    migrateWorkersBuild({ ...production, DROP_PRODUCTION_BRANCH: undefined }, configPath, noWrangler),
  )
})

test.each([
  ["template", { DROP_D1_MIGRATION_TOKEN: "migration-token" }, "migration-token"],
  [
    "build variable",
    { WORKERS_CI_BRANCH: "prod", DROP_PRODUCTION_BRANCH: "prod", CLOUDFLARE_D1_DATABASE_ID: "built-db" },
    "deploy-token",
  ],
])("Wrangler applies pending migrations to the generated DB from the %s", async (_source, overrides, token) => {
  const calls = []
  await withWranglerConfig(
    [
      { binding: "OTHER", database_id: "other-db" },
      { binding: "DB", database_id: "built-db" },
    ],
    async (configPath) => {
      await migrateWorkersBuild({ ...production, ...overrides }, configPath, (args, env) => calls.push({ args, env }))
      assert.deepEqual(
        calls.map(({ args }) => args),
        [["d1", "migrations", "apply", "DB", "--remote", "--config", configPath]],
      )
    },
  )
  assert.equal(calls[0].env.CLOUDFLARE_API_TOKEN, token)
  assert.equal(calls[0].env.CLOUDFLARE_ACCOUNT_ID, "test-account")
})

test.each([{ databases: [] }, { databases: [{ binding: "DB", database_id: "00000000-0000-4000-8000-000000000000" }] }])(
  "production fails instead of skipping when the generated DB has no real ID (%j)",
  async ({ databases }) => {
    await withWranglerConfig(databases, (configPath) =>
      assert.rejects(
        migrateWorkersBuild({ ...production, CLOUDFLARE_D1_DATABASE_ID: "unbound-db" }, configPath, noWrangler),
        /No deployed D1 database ID for DB/,
      ),
    )
  },
)

test("production with no token fails with setup instructions", async () => {
  await withWranglerConfig([{ binding: "DB", database_id: "built-db" }], (configPath) =>
    assert.rejects(
      migrateWorkersBuild({ ...production, CLOUDFLARE_API_TOKEN: undefined }, configPath, noWrangler),
      /DROP_D1_MIGRATION_TOKEN.*D1 Write/,
    ),
  )
})

test("a deploy-only token rejected by D1 fails with setup instructions", async () => {
  await withWranglerConfig([{ binding: "DB", database_id: "built-db" }], (configPath) =>
    assert.rejects(
      migrateWorkersBuild(production, configPath, (_args, env) => {
        assert.equal(env.CLOUDFLARE_API_TOKEN, "deploy-token")
        throw new Error("wrangler d1 migrations apply DB --remote exited with 1")
      }),
      (error) => {
        assert.match(error.message, /DROP_D1_MIGRATION_TOKEN.*D1 Write/)
        assert.match(error.cause.message, /exited with 1/)
        return true
      },
    ),
  )
})
