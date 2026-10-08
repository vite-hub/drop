import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { cloudflareTemplate, syncCloudflareTemplate } from "../../scripts/cloudflare-template.ts"

test("template resource ids survive Nitro's array merge and D1 build variables take priority", () => {
  const directory = mkdtempSync(join(tmpdir(), "drop-cloudflare-template-"))
  const file = join(directory, "wrangler.json")
  const template = structuredClone(cloudflareTemplate)
  const previousEnv = { ...process.env }
  try {
    cloudflareTemplate.name = "my-drop"
    cloudflareTemplate.d1_databases[0].database_id = "provisioned-d1-id"
    cloudflareTemplate.d1_databases[0].database_name = "my-database"
    cloudflareTemplate.kv_namespaces[0].id = "provisioned-kv-id"
    cloudflareTemplate.r2_buckets[0].bucket_name = "my-files"
    const generated = {
      ...template,
      main: "index.mjs",
      assets: { directory: "../public", binding: "ASSETS" },
      d1_databases: [...template.d1_databases, ...cloudflareTemplate.d1_databases],
      kv_namespaces: [...template.kv_namespaces, ...cloudflareTemplate.kv_namespaces],
      r2_buckets: [...template.r2_buckets, ...cloudflareTemplate.r2_buckets],
      secrets: { required: [...template.secrets.required, ...template.secrets.required] },
    }
    writeFileSync(file, JSON.stringify(generated))
    delete process.env.CLOUDFLARE_D1_DATABASE_ID
    delete process.env.CLOUDFLARE_D1_DATABASE_NAME
    syncCloudflareTemplate(directory)
    const config = JSON.parse(readFileSync(file, "utf8"))
    assert.equal(config.name, "my-drop")
    assert.equal(config.d1_databases.length, 1)
    assert.equal(config.d1_databases[0].database_id, "provisioned-d1-id")
    assert.equal(config.kv_namespaces[0].id, "provisioned-kv-id")
    assert.equal(config.r2_buckets[0].bucket_name, "my-files")
    assert.deepEqual(config.secrets.required, template.secrets.required)
    assert.equal(config.main, "index.mjs")
    assert.equal(config.assets.directory, "../public")
    process.env.CLOUDFLARE_D1_DATABASE_ID = "existing-build-id"
    process.env.CLOUDFLARE_D1_DATABASE_NAME = "existing-database"
    syncCloudflareTemplate(directory)
    const overridden = JSON.parse(readFileSync(file, "utf8"))
    assert.equal(overridden.d1_databases[0].database_id, "existing-build-id")
    assert.equal(overridden.d1_databases[0].database_name, "existing-database")
  }
  finally {
    Object.assign(cloudflareTemplate, template)
    process.env = previousEnv
    rmSync(directory, { recursive: true, force: true })
  }
})
