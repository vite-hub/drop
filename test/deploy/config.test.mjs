import assert from "node:assert/strict"
import { test } from "node:test"
import { deployment } from "../../scripts/deployment.ts"

test("host detection and explicit presets select compatible storage", () => {
  for (const [env, host, database] of [
    [{}, "cloudflare", "d1"],
    [{ VERCEL: "1" }, "vercel", "d1"],
    [{ NETLIFY: "true" }, "netlify", "d1"],
    [{ DENO_DEPLOYMENT_ID: "deployment" }, "deno", "d1"],
    [{ NITRO_PRESET: "node-server" }, "vps", "sqlite"],
    [{ SERVER_PRESET: "cloudflare-module" }, "cloudflare", "d1"],
    [{ DROP_HOST: "vps", VERCEL: "1" }, "vps", "sqlite"],
    [{ DROP_DATABASE_URL: "file:.data/custom.db" }, "vps", "sqlite"],
    [{ DROP_HOST: "vps", CLOUDFLARE_D1_DATABASE_ID: "existing" }, "vps", "d1"],
    [{ DROP_HOST: "vps", DROP_DATABASE: "d1" }, "vps", "d1"],
    [{ DROP_HOST: "vps", DROP_DATABASE: "sqlite", CLOUDFLARE_D1_DATABASE_ID: "existing" }, "vps", "sqlite"],
  ]) assert.deepEqual(deployment(env), { host, database }, JSON.stringify(env))
})

test("invalid or conflicting configuration fails instead of changing providers", () => {
  for (const env of [
    { DROP_HOST: "unknown" },
    { NITRO_PRESET: "unknown" },
    { DROP_HOST: "vps", NITRO_PRESET: "vercel" },
    { DROP_HOST: "vps", DROP_DATABASE: "postgres" },
    { DROP_HOST: "vercel", DROP_DATABASE: "sqlite" },
    { DROP_HOST: "cloudflare", DROP_DATABASE_URL: "file:test.db" },
    { DROP_HOST: "vps", DROP_DATABASE: "d1", DROP_DATABASE_URL: "file:test.db" },
    { DROP_HOST: "vps", DROP_DATABASE_URL: "libsql://remote" },
  ]) assert.throws(() => deployment(env), Error, JSON.stringify(env))
})
