import assert from "node:assert/strict"
import { test, vi } from "vite-plus/test"

vi.mock("nitro", () => ({ definePlugin: (plugin) => plugin }))
vi.mock("nitro/runtime-config", () => ({ useRuntimeConfig: () => ({ seoIndex: false }) }))

const { default: contentHeaders } = await import("../../server/plugins/content-headers.ts")
let onResponse
await contentHeaders({ hooks: { hook: (_name, fn) => (onResponse = fn) } })

const key = "00000000-0000-4000-8000-000000000001"
function respond(path, init = {}) {
  const response = new Response(init.status === 304 ? null : "bytes", init)
  onResponse(response, { req: new Request(`https://drop.example${path}`) })
  return response.headers.get("cache-control")
}

test("a file with an ETag is kept and revalidated; its 304 keeps that policy", () => {
  assert.equal(respond(`/f/${key}.png`, { headers: { ETag: '"abc"' } }), "private, no-cache")
  assert.equal(respond(`/f/${key}.png`, { status: 304 }), "private, no-cache")
})

test("rendered documents, errors, and share pages are never kept", () => {
  assert.equal(respond(`/f/${key}.md`), "private, no-store")
  assert.equal(respond(`/f/${key}.png`, { status: 404 }), "private, no-store")
  assert.equal(respond(`/f/${key}.png`, { status: 416, headers: { ETag: '"abc"' } }), "private, no-store")
  assert.equal(respond("/d/abc/slug", { headers: { ETag: '"abc"' } }), "private, no-store")
})
