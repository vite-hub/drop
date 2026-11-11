import assert from "node:assert/strict"
import { H3 } from "h3"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset, insertDrop, state, who } from "../cost/harness.mjs"

const { default: dropAccess } = await import("../../server/middleware/0.drop-access.ts")
const app = new H3().use(dropAccess).get("/d/**", () => "browser page")
const request = async (path, headers, method = "GET") =>
  app.fetch(new Request(`https://drop.quiver.dk${path}`, { headers, method }))

migrate()
beforeEach(() => {
  reset()
  state.mode = "team"
  insertDrop("5031emz9d85y", { kind: "folder", title: "SEO: getting Quiver listed", share: "team" })
  insertDrop("private", { title: "Secret title", share: "private" })
})

test("agent fetches get an MCP hint without disclosing whether the drop exists", async () => {
  for (const headers of [
    { "user-agent": "Claude-User (claude-code/2.1.316)", accept: "text/html" },
    { accept: "text/markdown" },
    { accept: "application/json" },
    { accept: "*/*" },
    {},
  ]) {
    const responses = await Promise.all(
      ["/d/5031emz9d85y/seo-listings", "/d/private", "/d/missing"].map((path) => request(path, headers)),
    )
    const bodies = []
    for (const response of responses) {
      assert.equal(response.status, 404)
      assert.equal(response.headers.get("location"), null)
      assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8")
      assert.equal(response.headers.get("cache-control"), "private, no-store")
      assert.equal(response.headers.get("vary"), "Accept, User-Agent")
      const body = await response.text()
      assert.match(body, /read_drop MCP tool/)
      assert.match(body, /https:\/\/drop\.quiver\.dk\/mcp/)
      assert.doesNotMatch(body, /SEO|Secret title|5031emz9d85y/)
      bodies.push(body)
    }
    assert.equal(new Set(bodies).size, 1)
  }
})

test("browser navigation keeps the existing inaccessible-drop response", async () => {
  const headers = { accept: "text/html,application/xhtml+xml,*/*;q=0.8", "user-agent": "Mozilla/5.0" }
  for (const path of ["/d/5031emz9d85y/seo-listings", "/d/private", "/d/missing"]) {
    const response = await request(path, headers)
    assert.equal(response.status, 404)
    assert.doesNotMatch(await response.text(), /read_drop|\/mcp/)
  }
})

test("HEAD gets the hint's status and headers without a body", async () => {
  const response = await request("/d/5031emz9d85y/seo-listings", { accept: "*/*" }, "HEAD")
  assert.equal(response.status, 404)
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8")
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal(await response.text(), "")
})

test("public and signed-in team reads keep passing through to the page", async () => {
  insertDrop("public", { share: "public" })
  const headers = { accept: "*/*" }
  assert.equal(await (await request("/d/public/public", headers)).text(), "browser page")
  state.who = who
  const response = await request("/d/5031emz9d85y/seo-getting-quiver-listed", headers)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), "browser page")
})
