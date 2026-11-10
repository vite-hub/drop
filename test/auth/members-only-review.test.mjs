import assert from "node:assert/strict"
import { H3 } from "h3"
import { afterEach, beforeEach, test } from "vite-plus/test"
import { migrate, reset, state } from "../cost/harness.mjs"

const { default: membersOnly } = await import("../../server/middleware/0.2.members-only.ts")
const app = new H3().use(membersOnly).all("/**", () => "reached the route")
const request = (path, method = "GET") =>
  app.fetch(
    new Request(`https://drop.quiver.dk${path}`, { method, headers: { origin: "https://pr1481.preview.quiver.dk" } }),
  )

migrate()
beforeEach(() => {
  reset()
  state.githubOrg = "acme"
})
afterEach(() => {
  state.githubOrg = ""
})

// review.js on a site sends no Drop session, only its review token, which each route checks (server/utils/review.ts).
test("a members-only Drop lets every review.js route through to its token check", async () => {
  for (const [method, path] of [
    ["OPTIONS", "/api/review/comments"],
    ["GET", "/api/review/comments"],
    ["POST", "/api/review/comments"],
    ["OPTIONS", "/api/review/comments/1"],
    ["PATCH", "/api/review/comments/1"],
    ["OPTIONS", "/api/review/comments/1/replies"],
    ["POST", "/api/review/comments/1/replies"],
    ["OPTIONS", "/api/review/images/abc"],
    ["GET", "/api/review/images/abc"],
  ]) {
    const response = await request(path, method)
    assert.equal(response.status, 200, `${method} ${path}`)
  }
})

test("the rest of /api/review still needs a member", async () => {
  for (const [method, path] of [
    ["POST", "/api/review/token"],
    ["POST", "/api/review/sites"],
    ["POST", "/api/review/open"],
    ["GET", "/api/review/comments/1/replies/x"],
  ]) {
    const response = await request(path, method)
    assert.equal(response.status, 401, `${method} ${path}`)
  }
})
