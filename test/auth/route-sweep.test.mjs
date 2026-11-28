import assert from "node:assert/strict"
import { globSync } from "node:fs"
import { H3 } from "h3"
import { afterEach, beforeEach, test } from "vite-plus/test"
import { migrate, reset, state } from "../cost/harness.mjs"

// A members-only Drop answers 401 to a request without a session on every route, except the ones listed here. Each
// of these checks access itself, so it is safe with no proxy in front of Drop. A new route fails this test until it
// is gated or added below with the check it runs.
const OPEN = {
  "* /api/auth/x/y": "Better Auth's sign-in and sign-up; its admin routes stay gated",
  "GET /api/sign-in": "starts sign-in",
  "POST /api/client-events": "sign-in steps from signed-out browsers: a closed list of names and codes, rate-limited",
  "GET /api/mcp": "MCP discovery; MCP calls carry an OAuth token",
  "GET /api/favicons/x": "site icons, fetched only from public icon services",
  "GET /api/me": "answers who is signed in, or nobody",
  "GET /api/links/x": "checks the link's share",
  "GET /api/drops/x": "checks the drop's share",
  "PATCH /api/drops/x": "checks the drop's share and the caller's role",
  "DELETE /api/drops/x": "checks the drop's share and the caller's role",
  "GET /api/drops/x/comments": "checks the drop's share",
  "POST /api/drops/x/comments": "checks the drop's share",
  "POST /api/drops/x/visit": "checks the drop's share",
  "POST /api/comments/x/replies": "checks the comment's drop and its share",
  "GET /api/review/comments": "review.js: checks its review token",
  "POST /api/review/comments": "review.js: checks its review token",
  "OPTIONS /api/review/comments": "review.js: CORS preflight",
  "POST /api/review/comments/refresh": "review.js: checks its review token and comment access",
  "OPTIONS /api/review/comments/refresh": "review.js: CORS preflight for an origin covered by a site review",
  "PATCH /api/review/comments/x": "review.js: checks its review token",
  "OPTIONS /api/review/comments/x": "review.js: CORS preflight",
  "POST /api/review/comments/x/replies": "review.js: checks its review token",
  "OPTIONS /api/review/comments/x/replies": "review.js: CORS preflight",
  "GET /api/review/images/x": "review.js: checks its review token",
  "OPTIONS /api/review/images/x": "review.js: CORS preflight",
  "GET /api/review/related": "review.js: checks its review token",
  "OPTIONS /api/review/related": "review.js: CORS preflight",
  "POST /api/review/presence": "review.js: checks its review token",
  "GET /api/review/notes/hello": "browser extension: names this Drop before it links, and says nothing about anyone",
  "GET /api/review/notes/index": "browser extension: checks its notes OAuth token and consent",
  "POST /api/review/notes/targets": "browser extension: checks its notes OAuth token and consent",
  "POST /api/review/notes/session": "browser extension: checks its notes OAuth token and consent",
  "OPTIONS /api/review/presence": "review.js: CORS preflight",
  "PUT /api/uploads/x": "checks its one-use upload ticket",
  "GET /d/x.md": "checks the drop's share",
  "GET /d/x/y.md": "checks the drop's share",
  "GET /mcp": "MCP: checks its OAuth token",
  "* /mcp": "MCP: checks its OAuth token",
  "GET /og/x": "checks the drop's share",
  "GET /review.js": "static script for reviewed sites",
  "GET /review-presence.js": "static script for reviewed sites",
  "GET /agents.md": "public instructions for agents",
  "GET /llms.txt": "public instructions for agents",
  "GET /signin/start": "starts sign-in",
}

const METHODS = new Set(["get", "post", "put", "patch", "delete", "options"])

/** `server/api/drops/[id]/pin.put.ts` → `PUT /api/drops/x/pin`, with every parameter filled with `x`, `y`… */
function routeOf(file) {
  const parts = file
    .replace(/^server\/routes/, "")
    .replace(/^server/, "")
    .replace(/\.ts$/, "")
    .split("/")
  const last = parts.pop().split(".")
  const method = METHODS.has(last.at(-1)) ? last.pop().toUpperCase() : "*"
  parts.push(last.join("."))
  let fill = 0
  if (parts.at(-1) === "index") parts.pop()
  const path = parts
    .map((part) =>
      part.replace(/\[\.\.\.[^\]]+\]/g, "x/y").replace(/\[[^\]]+\]/g, () => String.fromCharCode(120 + fill++)),
    )
    .join("/")
  return { key: `${method} ${path}`, method: method === "*" ? "POST" : method, path }
}

const routes = globSync(["server/api/**/*.ts", "server/routes/**/*.ts"]).sort().map(routeOf)

const { default: membersOnly } = await import("../../server/middleware/0.2.members-only.ts")
const app = new H3().use(membersOnly).all("/**", () => "reached the route")
const request = (path, method) => app.fetch(new Request(`https://drop.example.com${path}`, { method }))

migrate()
beforeEach(() => {
  reset()
  state.members = "github-org:acme"
})
afterEach(() => {
  state.members = ""
})

test("every route on a members-only Drop needs a session, or is listed with the check it runs itself", async () => {
  assert.ok(routes.length > 50, `found only ${routes.length} routes`)
  const wrong = []
  for (const { key, method, path } of routes) {
    const { status } = await request(path, method)
    const expected = key in OPEN ? 200 : 401
    if (status !== expected)
      wrong.push(`${key}: ${status}, expected ${expected}${key in OPEN ? "" : " or a reason in OPEN"}`)
  }
  assert.deepEqual(wrong, [])
})

test("the open list names no route that is gone", () => {
  const keys = new Set(routes.map((route) => route.key))
  assert.deepEqual(
    Object.keys(OPEN).filter((key) => !keys.has(key)),
    [],
  )
})

test("Better Auth's admin routes need a member", async () => {
  for (const path of ["/api/auth/admin/list-users", "/api/auth/admin/ban-user"])
    assert.equal((await request(path, "POST")).status, 401, path)
})
