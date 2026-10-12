import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { runInNewContext } from "node:vm"
import { H3Event } from "h3"
import { migrate, reset, insertDrop, state } from "../cost/harness.mjs"
const { contentOrigin, isContentRequest } = await import("../../server/utils/content-origin.ts")
const { default: contentMiddleware } = await import("../../server/middleware/0.05.content-origin.ts")
const { default: writesMiddleware } = await import("../../server/middleware/0.06.same-origin-writes.ts")
const { default: detailHandler } = await import("../../server/api/drops/[id].get.ts")
const { buildProjectDocument, pageAt, pageUrl } = await import("../../shared/project-bundle.ts")
const { injectRuntime, OPAQUE_ORIGIN_SHIM, prependToHead } = await import("../../shared/plan-runtime.ts")

migrate()
beforeEach(() => {
  reset()
  state.contentOrigin = "https://drop-usercontent.example"
  state.who = { userId: "owner", role: "member" }
})

function request(url, { method = "GET", headers = {} } = {}) {
  const event = new H3Event(new Request(url, { method, headers }))
  event.context.log = { set() {}, error() {} }
  return event
}

test("the content origin is a second host, never Drop's own, and ignored when unset or invalid", () => {
  assert.equal(contentOrigin(request("https://drop.example/d/x")), "https://drop-usercontent.example")
  assert.equal(isContentRequest(request("https://drop.example/d/x")), false)
  assert.equal(isContentRequest(request("https://drop-usercontent.example/")), true)
  state.contentOrigin = "https://drop.example"
  assert.equal(contentOrigin(request("https://drop.example/d/x")), null)
  for (const value of ["", "not a url", "javascript:alert(1)"]) {
    state.contentOrigin = value
    assert.equal(contentOrigin(request("https://drop.example/d/x")), null)
    assert.equal(isContentRequest(request("https://drop-usercontent.example/")), false)
  }
})

test("the content origin serves only the frame host, at any path, and nothing of Drop", async () => {
  for (const path of ["/", "/product/", "/api/me", "/d/abc", "/f/key.html"]) {
    const response = await contentMiddleware(request(`https://drop-usercontent.example${path}`, { headers: { "sec-fetch-dest": "iframe" } }))
    assert.equal(response.status, 200, path)
    const html = await response.text()
    assert.match(html, /document\.write\(message\.html\)/)
    assert.match(html, /event\.source !== parent/)
    assert.doesNotMatch(html, /__NUXT__|_nuxt/)
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow")
  }
  for (const [method, dest] of [["GET", "empty"], ["GET", "script"], ["POST", "iframe"], ["DELETE", null]]) {
    const response = await contentMiddleware(request("https://drop-usercontent.example/data.json", { method, headers: dest ? { "sec-fetch-dest": dest } : {} }))
    assert.equal(response.status, 404, `${method} ${dest}`)
  }
  assert.equal(await contentMiddleware(request("https://drop.example/d/abc")), undefined)
  state.contentOrigin = ""
  assert.equal(await contentMiddleware(request("https://drop-usercontent.example/")), undefined)
})

test("cookie-carrying API writes must come from Drop's own origin", () => {
  const cookie = { cookie: "__Host-drop.session_token=abc" }
  const blocked = [
    { ...cookie, "sec-fetch-site": "same-site", origin: "https://drop-usercontent.example" },
    { ...cookie, "sec-fetch-site": "cross-site" },
    { ...cookie, origin: "https://evil.example" },
  ]
  for (const headers of blocked)
    assert.throws(() => writesMiddleware(request("https://drop.example/api/drops/x", { method: "DELETE", headers })), error => error.status === 403)
  const allowed = [
    ["DELETE", "/api/drops/x", { ...cookie, "sec-fetch-site": "same-origin", origin: "https://drop.example" }],
    ["POST", "/api/apps", { ...cookie }],
    ["POST", "/api/apps", { "sec-fetch-site": "cross-site", origin: "https://agent.example" }],
    ["GET", "/api/drops/x", { ...cookie, "sec-fetch-site": "cross-site" }],
    ["POST", "/mcp", { ...cookie, origin: "https://evil.example" }],
  ]
  for (const [method, path, headers] of allowed)
    assert.equal(writesMiddleware(request(`https://drop.example${path}`, { method, headers })), undefined, `${method} ${path}`)
})

test("apps and HTML docs carry the content origin; other kinds don't", async () => {
  insertDrop("page", { kind: "html", filename: "page.html", blob_key: "page.html" })
  insertDrop("notes")
  insertDrop("app", { kind: "app", filename: "app", blob_key: null })
  for (const [id, expected] of [["page", "https://drop-usercontent.example"], ["notes", undefined], ["app", "https://drop-usercontent.example"]]) {
    const event = request(`https://drop.example/api/drops/${id}`)
    event.context.params = { id }
    assert.equal((await detailHandler(event)).contentOrigin, expected, id)
  }
  state.contentOrigin = ""
  const event = request("https://drop.example/api/drops/app")
  event.context.params = { id: "app" }
  assert.equal((await detailHandler(event)).contentOrigin, undefined)
})

test("app pages map to the URLs a static host serves them at", () => {
  const pages = ["index.html", "about.html", "product/index.html", "docs/a b/index.html"]
  for (const [path, page] of [["/", "index.html"], ["", "index.html"], ["/product/", "product/index.html"], ["/product", "product/index.html"], ["/about", "about.html"], ["/about.html", "about.html"], ["/docs/a b/", "docs/a b/index.html"], ["/missing", null]])
    assert.equal(pageAt(pages, path), page, path)
  assert.equal(pageUrl("index.html"), "/")
  assert.equal(pageUrl("product/index.html"), "/product/")
  assert.equal(pageUrl("about.html"), "/about.html")
  assert.equal(pageUrl("docs/a b/index.html"), "/docs/a%20b/")
  for (const page of pages) assert.equal(pageAt(pages, decodeURI(pageUrl(page))), page)
})

test("Drop's scripts go first in the head without dropping the page out of standards mode", () => {
  assert.equal(prependToHead("<!doctype html><html><head><title>x</title></head></html>", "<x>"), "<!doctype html><html><head><x><title>x</title></head></html>")
  assert.equal(prependToHead("<!DOCTYPE html><p>hi", "<x>"), "<!DOCTYPE html><x><p>hi")
  assert.equal(prependToHead("<p>hi", "<x>"), "<x><p>hi")
  const app = injectRuntime(buildProjectDocument({ "index.html": "<!doctype html><html><head></head><body><a href=\"/about/\">About</a></body></html>", "about/index.html": "" }, "index.html"), false)
  assert.ok(app.startsWith("<!doctype html>"))
  assert.ok(app.indexOf('if (self.origin !== "null") return;') < app.indexOf("const pageAt"), "the opaque shim runs before the app runtime")
})

/** Runs the shim in a window whose storage, cookies, and URL changes throw, like an opaque-origin sandbox. */
function opaqueWindow(origin = "null") {
  const insecure = () => { throw new Error("The operation is insecure.") }
  const calls = []
  const history = {
    pushState(state, title, url) { if (url !== undefined) insecure(); calls.push(["push", state]) },
    replaceState(state, title, url) { if (url !== undefined) insecure(); calls.push(["replace", state]) },
  }
  const document = {}
  Object.defineProperty(document, "cookie", { configurable: true, get: insecure, set: insecure })
  const window = { history, document, self: { origin }, calls }
  window.window = window
  for (const name of ["localStorage", "sessionStorage"]) Object.defineProperty(window, name, { configurable: true, get: insecure })
  runInNewContext(OPAQUE_ORIGIN_SHIM, window)
  return window
}

test("in an opaque sandbox, storage and cookies last for the page and URL changes keep their state", () => {
  const window = opaqueWindow()
  window.localStorage.setItem("palette", "slate")
  assert.equal(window.localStorage.getItem("palette"), "slate")
  assert.equal(window.localStorage.length, 1)
  assert.equal(window.localStorage.key(0), "palette")
  window.localStorage.removeItem("palette")
  assert.equal(window.localStorage.getItem("palette"), null)
  window.sessionStorage.setItem("n", 1)
  assert.equal(window.sessionStorage.getItem("n"), "1")
  window.document.cookie = "a=1; path=/"
  window.document.cookie = "b=2"
  assert.equal(window.document.cookie, "a=1; b=2")
  window.document.cookie = "a=; max-age=0"
  assert.equal(window.document.cookie, "b=2")
  window.history.pushState({ page: 2 }, "", "/product/")
  window.history.replaceState({ page: 3 }, "", "#top")
  assert.deepEqual(window.calls, [["push", { page: 2 }], ["replace", { page: 3 }]])
})

test("on a real origin the shim leaves the browser's own storage alone", () => {
  assert.throws(() => opaqueWindow("https://drop-usercontent.example").localStorage)
})
