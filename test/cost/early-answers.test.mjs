import assert from "node:assert/strict"
import { toResponse } from "h3"
import { beforeEach, test } from "vite-plus/test"
import { queries, state, migrate, reset, insertDrop, event, who } from "./harness.mjs"
const { default: mcpRoute } = await import("../../server/routes/mcp.ts")
const { default: mcpGet } = await import("../../server/routes/mcp.get.ts")
const { default: accessMiddleware } = await import("../../server/middleware/0.drop-access.ts")

// Requests that can be answered before the costly part: a token check on D1, or a server render of the page.
migrate()
let identified = 0
let current = null
Object.defineProperty(state, "who", {
  configurable: true,
  get: () => (identified++, current),
  set: (value) => (current = value),
})
beforeEach(() => {
  reset()
  identified = 0
})

const mcp = async (method, headers = {}) => {
  const request = event("/mcp", method)
  for (const [name, value] of Object.entries(headers)) request.req.headers.set(name, value)
  return toResponse(await (method === "GET" ? mcpGet : mcpRoute)(request), request)
}

test("GET /mcp with a token is a 405 before the token is checked", async () => {
  current = who
  const response = await mcp("GET", { authorization: "Bearer token", accept: "text/event-stream" })
  assert.equal(response.status, 405)
  assert.equal(response.headers.get("allow"), "POST")
  assert.equal(identified, 0)
  assert.equal(queries.length, 0)
})

test("GET /mcp without a token is still the 401 that points at the protected resource metadata", async () => {
  const response = await mcp("GET", { accept: "text/event-stream" })
  assert.equal(response.status, 401)
  assert.match(
    response.headers.get("www-authenticate"),
    /^Bearer .*resource_metadata="https:\/\/drop\.example\/\.well-known\/oauth-protected-resource\/mcp"/,
  )
  assert.equal(identified, 0)
})

test("POST /mcp still checks the token", async () => {
  await mcp("POST", { authorization: "Bearer token", "content-type": "application/json" })
  assert.equal(identified, 1)
})

test("POST /mcp with a refused token names it invalid_token on the challenge (RFC 6750 §3.1)", async () => {
  current = null
  const refused = await mcp("POST", { authorization: "Bearer expired", "content-type": "application/json" })
  assert.equal(refused.status, 401)
  assert.match(refused.headers.get("www-authenticate"), /^Bearer .*resource_metadata="[^"]+", error="invalid_token"$/)
  const missing = await mcp("POST", { "content-type": "application/json" })
  assert.equal(missing.status, 401)
  assert.doesNotMatch(missing.headers.get("www-authenticate"), /error=/)
})

const page = async (path, method) => {
  const request = event(path, method)
  const answer = await accessMiddleware(request)
  return answer === undefined ? undefined : toResponse(answer, request)
}

test("HEAD on a share page answers without rendering it", async () => {
  insertDrop("doc", { title: "The doc", share: "public" })
  const response = await page("/d/doc/the-doc", "HEAD")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "text/html;charset=utf-8")
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal(await response.text(), "")
  // The address the page moves to, as its render would.
  const moved = await page("/d/doc?from=1", "HEAD")
  assert.equal(moved.status, 302)
  assert.equal(moved.headers.get("location"), "/d/doc/the-doc?from=1")
  // A pinned version renders, since the page checks that it exists; GET renders.
  assert.equal(await page("/d/doc/the-doc?v=3", "HEAD"), undefined)
  assert.equal(await page("/d/doc/the-doc", "GET"), undefined)
})

test("GET on a share link without its slug redirects before the page renders", async () => {
  insertDrop("doc", { title: "The doc", share: "public" })
  for (const path of ["/d/doc", "/d/doc/an-old-title"]) {
    const response = await page(`${path}?present`, "GET")
    assert.equal(response.status, 302)
    assert.equal(response.headers.get("location"), "/d/doc/the-doc?present")
  }
  // A pinned version is the page's to check first.
  assert.equal(await page("/d/doc?v=3", "GET"), undefined)
})

test("HEAD on a share page someone can't open keeps the page's status", async () => {
  insertDrop("doc", { title: "The doc", share: "private" })
  await assert.rejects(page("/d/doc/the-doc", "HEAD"), (error) => error.status === 404)
})
