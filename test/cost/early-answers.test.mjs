import assert from "node:assert/strict"
import { toResponse } from "h3"
import { beforeEach, test } from "vite-plus/test"
import { queries, state, migrate, reset, event, who } from "./harness.mjs"
const { default: mcpRoute } = await import("../../server/routes/mcp.ts")
const { default: mcpGet } = await import("../../server/routes/mcp.get.ts")

// Requests that can be answered before the costly part: a token check on D1.
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
