import assert from "node:assert/strict"
import { test, vi } from "vite-plus/test"
import { deployment } from "../../scripts/deployment.ts"

test("host detection and explicit hosts select compatible storage", () => {
  for (const [env, host, database] of [
    [{}, "cloudflare", "d1"],
    [{ VERCEL: "1" }, "vercel", "d1"],
    [{ NETLIFY: "true" }, "netlify", "d1"],
    [{ DENO_DEPLOYMENT_ID: "deployment" }, "deno", "d1"],
    [{ NITRO_PRESET: "node-server" }, "vps", "sqlite"],
    [{ SERVER_PRESET: "cloudflare-module" }, "cloudflare", "d1"],
    [{ VITEHUB_HOST: "netlify" }, "netlify", "d1"],
    [{ VITEHUB_HOST: "node", VERCEL: "1" }, "vps", "sqlite"],
    [{ DROP_HOST: "vps" }, "vps", "sqlite"],
    [{ DROP_HOST: "vps", VERCEL: "1" }, "vps", "sqlite"],
    [{ DROP_HOST: "vps", VITEHUB_HOST: "deno" }, "deno", "d1"],
    [{ DROP_DATABASE_URL: "file:.data/custom.db" }, "vps", "sqlite"],
    [{ VITEHUB_HOST: "node", CLOUDFLARE_D1_DATABASE_ID: "existing" }, "vps", "d1"],
    [{ VITEHUB_HOST: "node", DROP_DATABASE: "d1" }, "vps", "d1"],
    [{ VITEHUB_HOST: "node", DROP_DATABASE: "sqlite", CLOUDFLARE_D1_DATABASE_ID: "existing" }, "vps", "sqlite"],
  ])
    assert.deepEqual(deployment(env), { host, database }, JSON.stringify(env))
})

// A NITRO_PRESET that conflicts with the host fails in ViteHub's build, not here.
test("invalid configuration fails instead of changing providers", () => {
  for (const env of [
    { DROP_HOST: "unknown" },
    { VITEHUB_HOST: "node", DROP_DATABASE: "postgres" },
    { VITEHUB_HOST: "vercel", DROP_DATABASE: "sqlite" },
    { VITEHUB_HOST: "cloudflare", DROP_DATABASE_URL: "file:test.db" },
    { VITEHUB_HOST: "node", DROP_DATABASE: "d1", DROP_DATABASE_URL: "file:test.db" },
    { VITEHUB_HOST: "node", DROP_DATABASE_URL: "libsql://remote" },
  ])
    assert.throws(() => deployment(env), Error, JSON.stringify(env))
})

test("Nuxt shares the legacy host override with ViteHub's build validator", async () => {
  vi.resetModules()
  vi.stubGlobal("defineNuxtConfig", (config) => config)
  vi.stubEnv("VITEHUB_HOST", undefined)
  vi.stubEnv("DROP_HOST", "vps")
  vi.stubEnv("VERCEL", "1")
  try {
    const { default: config } = await import("../../nuxt.config.ts")
    assert.equal(config.vitehub.host, "node")
    assert.equal(process.env.VITEHUB_HOST, "node")
  } finally {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  }
})

test.each([
  ["cloudflare", false],
  ["vercel", false],
  ["netlify", false],
  ["vps", true],
  ["deno", true],
])("%s registers only its intended health handler", async (host, databaseOnly) => {
  vi.resetModules()
  vi.stubGlobal("defineNuxtConfig", (config) => config)
  vi.stubEnv("VITEHUB_HOST", host === "vps" ? "node" : host)
  vi.stubEnv("DROP_HOST", host === "vps" ? "deno" : "vps")
  vi.stubEnv("DROP_DATABASE", undefined)
  vi.stubEnv("DROP_DATABASE_URL", undefined)
  vi.stubEnv("VITEHUB_BUILD_COMMIT", "health-test-commit")
  try {
    const { default: config } = await import("../../nuxt.config.ts")
    assert.equal(process.env.VITEHUB_HOST, host === "vps" ? "node" : host)
    const handlers = config.nitro.handlers?.filter(({ route }) => route === "/api/health") ?? []
    if (databaseOnly) {
      assert.equal(config.vitehub.health, undefined)
      assert.equal(handlers.length, 1)
      assert.equal(handlers[0].method, "GET")
      assert.match(handlers[0].handler, /[/\\]server[/\\]handlers[/\\]database-health\.ts$/)
      assert.equal(config.runtimeConfig.release.commit, "health-test-commit")
    } else {
      assert.deepEqual(config.vitehub.health, { route: "/api/health" })
      assert.deepEqual(handlers, [])
    }
  } finally {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  }
})
