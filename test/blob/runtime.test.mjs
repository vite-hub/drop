import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { blob } from "vite-hub/blob"
import { setActiveCloudflareEnv, setBlobRuntimeConfig, setBlobRuntimeStorage } from "vite-hub/_internal/blob/runtime/state"

// Exercise the installed patch through the real R2 driver and served-URL wrapper.
afterEach(() => {
  setActiveCloudflareEnv(undefined)
  setBlobRuntimeConfig(undefined)
  setBlobRuntimeStorage(undefined)
})

test("R2 missing heads and reads preserve null with /f serving enabled", async () => {
  setBlobRuntimeConfig({ store: { driver: "cloudflare-r2", binding: "BLOB", bucketName: "drop" }, serve: { route: "/f", store: "default" } })
  setActiveCloudflareEnv({ BLOB: { head: async () => null, get: async () => null } })
  assert.deepEqual(await blob.head("unknown.txt"), [null, null])
  assert.deepEqual(await blob.get("unknown.txt"), [null, null])
})

test("R2 failures remain errors and existing heads retain their served URL", async () => {
  const cause = new Error("R2 unavailable")
  setBlobRuntimeConfig({ store: { driver: "cloudflare-r2", binding: "BLOB", bucketName: "drop" }, serve: { route: "/f", store: "default" } })
  setActiveCloudflareEnv({ BLOB: { head: async key => {
    if (key === "failure.txt") throw cause
    return { key, size: 5, uploaded: new Date("2026-01-01"), httpMetadata: { contentType: "text/plain" } }
  } } })
  const [error, missing] = await blob.head("failure.txt")
  assert.equal(error.code, "BLOB_OPERATION_FAILED")
  assert.equal(error.cause, cause)
  assert.equal(missing, undefined)
  const [headError, object] = await blob.head("existing.txt")
  assert.equal(headError, null)
  assert.equal(object.url, "/f/existing.txt")
})
