import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { shouldMigrate } from "../../scripts/migrate-workers-builds.mjs"

const production = { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main", CLOUDFLARE_D1_DATABASE_ID: "db" }

test("a Workers Builds build of main migrates D1 before the deploy step", () => {
  assert.equal(shouldMigrate(production), true)
})

test("preview branches, other hosts and builds without a D1 id leave the database alone", () => {
  assert.equal(shouldMigrate({ ...production, WORKERS_CI_BRANCH: "feat/pins" }), false)
  assert.equal(shouldMigrate({ ...production, WORKERS_CI: undefined }), false)
  assert.equal(shouldMigrate({ ...production, CLOUDFLARE_D1_DATABASE_ID: " " }), false)
})

test("a deployment whose production branch isn't main names it", () => {
  const env = { ...production, WORKERS_CI_BRANCH: "prod", DROP_PRODUCTION_BRANCH: "prod" }
  assert.equal(shouldMigrate(env), true)
})
