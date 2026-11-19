import assert from "node:assert/strict"
import { test, vi } from "vite-plus/test"
import { H3, H3Event, HTTPError, HTTPResponse } from "h3"
import { migrate, state } from "../cost/harness.mjs"

vi.mock("nitro", () => ({ definePlugin: (plugin) => plugin }))
vi.mock("nitro/runtime-config", () => ({ useRuntimeConfig: () => ({ seoIndex: false }) }))

const { default: contentHeaders } = await import("../../server/plugins/content-headers.ts")
const { default: contentError } = await import("../../server/handlers/content-error.ts")
const { identify, sessionOf } = await import("../../server/utils/identity.ts")
let onResponse
await contentHeaders({ hooks: { hook: (_name, fn) => (onResponse = fn) } })
migrate()

const key = "00000000-0000-4000-8000-000000000001"
function respond(path, init = {}) {
  const response = new Response(init.status === 304 ? null : "bytes", init)
  onResponse(response, new H3Event(new Request(`https://drop.example${path}`)))
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

test.each([
  ["proxy session", sessionOf],
  ["browser identity", identify],
])("%s renewal reaches the final response, including HTML, JSON and plain-text misses", async (_name, readSession) => {
  const renewal = "session_token=renewed; Path=/; Max-Age=604800; HttpOnly"
  const replacement = "session_token=replacement; Path=/; HttpOnly"
  const authApi = state.authApi
  state.authApi = {
    getSession: async ({ returnHeaders }) => {
      assert.equal(returnHeaders, true)
      return { headers: new Headers({ "Set-Cookie": renewal }), response: null }
    },
  }
  try {
    const app = new H3({ onError: contentError, onResponse }).use(async (event) => {
      await readSession(event)
      event.context.dropIdentity = Promise.resolve(null)
    })
    app.get("/d/missing", () => {
      throw new HTTPError({ status: 404 })
    })
    app.get("/api/drops/missing", () => {
      throw new HTTPError({ status: 404 })
    })
    app.get("/d/plain", () => new HTTPResponse("Not found", { status: 404 }))
    app.get("/api/me", (event) => {
      event.res.headers.append("Set-Cookie", replacement)
      return { ok: true }
    })
    for (const path of ["/d/missing", "/api/drops/missing", "/d/plain", "/api/me"]) {
      const response = await app.fetch(new Request(`https://drop.example${path}`))
      assert.equal(response.status, path === "/api/me" ? 200 : 404, path)
      assert.deepEqual(response.headers.getSetCookie(), path === "/api/me" ? [renewal, replacement] : [renewal], path)
      assert.equal(response.headers.get("cache-control"), "private, no-store", path)
    }
  } finally {
    state.authApi = authApi
  }
})
