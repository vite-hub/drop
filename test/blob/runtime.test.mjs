import assert from "node:assert/strict"
import { afterEach, test } from "vite-plus/test"
import { H3 } from "h3"
import { blob } from "vite-hub/blob"
import {
  setActiveCloudflareEnv,
  setBlobRuntimeConfig,
  setBlobRuntimeStorage,
} from "vite-hub/_internal/blob/runtime/state"

// Exercise the installed patch through the real R2 driver and served-URL wrapper.
afterEach(() => {
  setActiveCloudflareEnv(undefined)
  setBlobRuntimeConfig(undefined)
  setBlobRuntimeStorage(undefined)
})

test("R2 missing heads and reads preserve null with /f serving enabled", async () => {
  setBlobRuntimeConfig({
    store: { driver: "cloudflare-r2", binding: "BLOB", bucketName: "drop" },
    serve: { route: "/f", store: "default" },
  })
  setActiveCloudflareEnv({ BLOB: { head: async () => null, get: async () => null } })
  assert.deepEqual(await blob.head("unknown.txt"), [null, null])
  assert.deepEqual(await blob.get("unknown.txt"), [null, null])
})

test("R2 failures remain errors and existing heads retain their served URL", async () => {
  const cause = new Error("R2 unavailable")
  setBlobRuntimeConfig({
    store: { driver: "cloudflare-r2", binding: "BLOB", bucketName: "drop" },
    serve: { route: "/f", store: "default" },
  })
  setActiveCloudflareEnv({
    BLOB: {
      head: async (key) => {
        if (key === "failure.txt") throw cause
        return { key, size: 5, uploaded: new Date("2026-01-01"), httpMetadata: { contentType: "text/plain" } }
      },
    },
  })
  const [error, missing] = await blob.head("failure.txt")
  assert.equal(error.code, "BLOB_OPERATION_FAILED")
  assert.equal(error.cause, cause)
  assert.equal(missing, undefined)
  const [headError, object] = await blob.head("existing.txt")
  assert.equal(headError, null)
  assert.equal(object.url, "/f/existing.txt")
})

test("serve answers a byte range with 206 so videos can seek", async () => {
  const bytes = new Uint8Array(1000).map((_, index) => index % 256)
  const object = {
    key: "clip.mp4",
    size: bytes.byteLength,
    uploaded: new Date("2026-01-01"),
    httpEtag: '"v1"',
    httpMetadata: { contentType: "video/mp4" },
  }
  setBlobRuntimeConfig({
    store: { driver: "cloudflare-r2", binding: "BLOB", bucketName: "drop" },
    serve: { route: "/f", store: "default" },
  })
  setActiveCloudflareEnv({
    BLOB: {
      head: async () => object,
      get: async () => ({ ...object, arrayBuffer: async () => bytes.buffer.slice(0) }),
    },
  })
  const serve = async (range) => {
    const app = new H3().get("/f/clip.mp4", async (event) => {
      const [error, stream] = await blob.serve(event, "clip.mp4")
      if (error) throw error
      return stream
    })
    return app.fetch(new Request("http://drop.test/f/clip.mp4", { headers: range ? { range } : {} }))
  }

  const whole = await serve()
  assert.equal(whole.status, 200)
  assert.equal(whole.headers.get("accept-ranges"), "bytes")
  assert.equal((await whole.arrayBuffer()).byteLength, 1000)

  const part = await serve("bytes=100-199")
  assert.equal(part.status, 206)
  assert.equal(part.headers.get("content-range"), "bytes 100-199/1000")
  assert.equal(part.headers.get("content-length"), "100")
  assert.deepEqual(new Uint8Array(await part.arrayBuffer()), bytes.slice(100, 200))

  const tail = await serve("bytes=-10")
  assert.equal(tail.headers.get("content-range"), "bytes 990-999/1000")

  const beyond = await serve("bytes=5000-")
  assert.equal(beyond.status, 416)
  assert.equal(beyond.headers.get("content-range"), "bytes */1000")
})
