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

test("a folder's skill discovery keeps the minute it's cached for; its misses are never kept", () => {
  const cached = { headers: { "Cache-Control": "public, max-age=60" } }
  assert.equal(respond("/d/abc/skill-hub/.well-known/agent-skills/index.json", cached), "public, max-age=60")
  assert.equal(respond("/d/abc/.well-known/skills/x/SKILL.md", cached), "public, max-age=60")
  assert.equal(respond("/d/abc/.well-known/skills/x/SKILL.md", { ...cached, status: 404 }), "private, no-store")
})

test("an answer that sets a cookie is never kept, whatever it was cached for", () => {
  // The auth proxy's session middleware (server/middleware/0.15.proxy-session.ts) adds the cookie before any handler runs.
  const session = (cacheControl, extra = {}) => ({
    headers: { "Cache-Control": cacheControl, "Set-Cookie": "session=secret; Path=/; HttpOnly", ...extra },
  })
  assert.equal(
    respond("/d/abc/skill-hub/.well-known/agent-skills/index.json", session("public, max-age=60")),
    "private, no-store",
  )
  assert.equal(respond("/d/abc/.well-known/skills/x/SKILL.md", session("public, max-age=60")), "private, no-store")
  assert.equal(respond("/.well-known/skills/index.json", session("public, max-age=60")), "private, no-store")
  assert.equal(respond("/llms.txt", session("public, max-age=300")), "private, no-store")
  assert.equal(respond("/_nuxt/app.js", session("public, max-age=31536000, immutable")), "private, no-store")
  assert.equal(respond(`/f/${key}.png`, session("private, no-cache", { ETag: '"abc"' })), "private, no-store")
})
