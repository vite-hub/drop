import assert from "node:assert/strict"
import { defineMiddleware, H3 } from "h3"
import { defineContentMarkdownHandler } from "vite-hub/content/markdown"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset, insertDrop, state, who } from "../cost/harness.mjs"

const { default: dropAccess } = await import("../../server/middleware/0.drop-access.ts")
const { default: shortCopy } = await import("../../server/routes/d/[link].md.get.ts")
const { default: namedCopy } = await import("../../server/routes/d/[link]/[slug].md.get.ts")
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

test("a share link's .md copy passes the same gate, then its route answers without a redirect", async () => {
  insertDrop("public", { share: "public" })
  const headers = { accept: "*/*" }
  for (const path of ["/d/public.md", "/d/public/any-slug.md"]) {
    const response = await request(path, headers)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), "browser page")
  }
  for (const path of ["/d/private.md", "/d/missing/slug.md"]) {
    const response = await request(path, headers)
    assert.equal(response.status, 404)
    assert.match(await response.text(), /read_drop MCP tool/)
  }
})

function markdownApp(versions) {
  const app = new H3()
    .use(dropAccess)
    .use(
      defineMiddleware(
        defineContentMarkdownHandler(
          { seo: { markdown: true }, markdown: async () => null },
          { render: (request) => app.fetch(request) },
        ),
      ),
    )
    .get("/d/:link.md", shortCopy)
    .get("/d/:link/:slug.md", namedCopy)
    .get("/d/**", () => new Response("viewer", { headers: { "content-type": "text/html" } }))
    .get("/api/links/public", (event) => ({
      id: "public",
      version: Number(event.url.searchParams.get("v") ?? versions.length),
      latest: versions.length,
    }))
    .get("/api/drops/public", (event) => ({
      kind: "markdown",
      content: versions[Number(event.url.searchParams.get("v") ?? versions.length) - 1],
    }))
  return (path, method = "GET", headers = { accept: "text/markdown" }) =>
    app.fetch(new Request(new URL(path, "https://drop.quiver.dk"), { method, headers }))
}

test("authorized Markdown GET and HEAD reach Content on canonical, bare, and stale links", async () => {
  insertDrop("public", { kind: "markdown", share: "public" })
  const send = markdownApp(["# Original\n"])
  for (const path of ["/d/public/public", "/d/public", "/d/public/stale"]) {
    const get = await send(path)
    const head = await send(path, "HEAD")
    assert.equal(get.status, 200)
    assert.equal(head.status, 200)
    assert.equal(await get.text(), "# Original\n")
    assert.equal(await head.text(), "")
    assert.equal(head.headers.get("content-type"), "text/markdown; charset=utf-8")
    assert.ok(get.headers.has("etag"))
    assert.equal(head.headers.get("etag"), get.headers.get("etag"))
    const fresh = await send(path, "GET", { accept: "text/markdown", "if-none-match": get.headers.get("etag") })
    assert.equal(fresh.status, 304)
  }
  assert.equal((await send("/d/public", "GET", { accept: "text/html, text/markdown" })).status, 302)
  assert.equal((await send("/d/private.md")).status, 404)
})

test("the pinned Markdown location still identifies v1 after publishing v2", async () => {
  insertDrop("public", { kind: "markdown", share: "public" })
  const versions = ["original"]
  const send = markdownApp(versions)
  versions.push("second")
  const pinned = await send("/d/public/public?v=1")
  assert.equal(await pinned.text(), "original")
  const location = pinned.headers.get("content-location")
  assert.equal(location, "/d/public/public.md?v=1")
  assert.equal(await (await send(location)).text(), "original")
  assert.equal(await (await send("/d/public/public.md")).text(), "second")
})

test("empty published Markdown is a successful representation at both URLs", async () => {
  insertDrop("public", { kind: "markdown", share: "public" })
  const send = markdownApp([""])
  for (const path of ["/d/public/public", "/d/public/public.md"]) {
    const response = await send(path)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8")
    assert.equal(await response.text(), "")
  }
})
