import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { runInNewContext } from "node:vm"
import { H3Event } from "h3"
import { migrate, reset, insertDrop, objects, sql, state } from "../cost/harness.mjs"
const { contentOrigin, FRAME_HOST_HTML, isContentRequest } = await import("../../server/utils/content-origin.ts")
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

test("the content origin is a second host, never Drop's own, and ignored when unset or invalid", async () => {
  assert.equal(await contentOrigin(request("https://drop.example/d/x"), "x"), "https://drop-usercontent.example")
  assert.equal(isContentRequest(request("https://drop.example/d/x")), false)
  assert.equal(isContentRequest(request("https://drop-usercontent.example/")), true)
  assert.equal(isContentRequest(request("https://drop-usercontent.example:8443/")), false)
  state.contentOrigin = "https://drop.example"
  assert.equal(await contentOrigin(request("https://drop.example/d/x"), "x"), null)
  state.contentOrigin = "http://localhost:3001"
  assert.equal(await contentOrigin(request("http://localhost:3000/d/x"), "x"), "http://localhost:3001")
  for (const value of ["", "not a url", "javascript:alert(1)", "javascript://*.x"]) {
    state.contentOrigin = value
    assert.equal(await contentOrigin(request("https://drop.example/d/x"), "x"), null)
    assert.equal(isContentRequest(request("https://drop-usercontent.example/")), false)
  }
})

test("a wildcard content origin gives every drop its own origin, named by a hash rather than its id", async () => {
  state.contentOrigin = "https://*.drop-usercontent.example"
  const id = "8f14e45f-ceea-4672-8e3b-6b1c2b0d5a11"
  const first = await contentOrigin(request("https://drop.example/d/x"), id)
  assert.match(first, /^https:\/\/[a-z2-7]{26}\.drop-usercontent\.example$/)
  assert.equal(await contentOrigin(request("https://drop.example/d/y"), id), first)
  assert.notEqual(await contentOrigin(request("https://drop.example/d/x"), "another-id"), first)
  assert.doesNotMatch(first, /8f14e45f/)
  assert.equal(isContentRequest(request(`${first}/index.html`)), true)
  for (const host of [
    "drop-usercontent.example",
    "evil.drop-usercontent.example",
    "a.b.drop-usercontent.example",
    "drop.example",
  ])
    assert.equal(isContentRequest(request(`https://${host}/`)), false, host)
  const response = await contentMiddleware(request(`${first}/about/`, { headers: { "sec-fetch-dest": "iframe" } }))
  assert.equal(response.status, 200)
  state.contentOrigin = "http://*.localhost:3000"
  assert.match(await contentOrigin(request("http://localhost:3000/d/x"), id), /^http:\/\/[a-z2-7]{26}\.localhost:3000$/)
})

test("a wildcard can sit inside the first label, one level under the zone, and matches nothing else there", async () => {
  state.contentOrigin = "https://*-drop.vitehub.dev"
  const id = "8f14e45f-ceea-4672-8e3b-6b1c2b0d5a11"
  const origin = await contentOrigin(request("https://drop.vitehub.dev/d/x"), id)
  assert.match(origin, /^https:\/\/[a-z2-7]{26}-drop\.vitehub\.dev$/)
  assert.equal(isContentRequest(request(`${origin}/`)), true)
  for (const host of [
    "drop.vitehub.dev",
    "vitehub.dev",
    "babysitter.vitehub.dev",
    "x-drop.vitehub.dev",
    "drop-usercontent.vitehub.dev",
    `${origin.slice(8, 34)}.vitehub.dev`,
  ])
    assert.equal(isContentRequest(request(`https://${host}/`)), false, host)
  assert.equal(
    await contentMiddleware(request("https://drop.vitehub.dev/", { headers: { "sec-fetch-dest": "document" } })),
    undefined,
  )
  for (const host of ["evil-drop.vitehub.dev", "x-drop.vitehub.dev", `${origin.slice(8, 20)}-drop.vitehub.dev`]) {
    const response = await contentMiddleware(request(`https://${host}/`, { headers: { "sec-fetch-dest": "document" } }))
    assert.equal(response?.status, 404, host)
  }
  state.contentOrigin = "https://*.usercontent.vitehub.dev"
  assert.equal(
    await contentMiddleware(
      request("https://evil.usercontent.vitehub.dev/", { headers: { "sec-fetch-dest": "document" } }),
    ),
    undefined,
  )
  for (const value of ["https://*.*.x.dev", "https://x.*.dev", "https://*", "ftp://*.x.dev", "https://*.x.dev/path"]) {
    state.contentOrigin = value
    assert.equal(await contentOrigin(request("https://drop.vitehub.dev/d/x"), id), null, value)
  }
})

test("the content origin serves only the frame host, at any path, and nothing of Drop", async () => {
  for (const path of ["/", "/product/", "/api/me", "/d/abc", "/f/key.html"]) {
    const response = await contentMiddleware(
      request(`https://drop-usercontent.example${path}`, { headers: { "sec-fetch-dest": "iframe" } }),
    )
    assert.equal(response.status, 200, path)
    const html = await response.text()
    assert.match(html, /document\.write\(message\.html\)/)
    assert.match(html, /event\.source !== parent/)
    assert.doesNotMatch(html, /__NUXT__|_nuxt/)
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow")
  }
  for (const [method, dest] of [
    ["GET", "empty"],
    ["GET", "script"],
    ["POST", "iframe"],
    ["DELETE", null],
  ]) {
    const response = await contentMiddleware(
      request("https://drop-usercontent.example/data.json", {
        method,
        headers: dest ? { "sec-fetch-dest": dest } : {},
      }),
    )
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
    assert.throws(
      () => writesMiddleware(request("https://drop.example/api/drops/x", { method: "DELETE", headers })),
      (error) => error.status === 403,
    )
  const allowed = [
    ["DELETE", "/api/drops/x", { ...cookie, "sec-fetch-site": "same-origin", origin: "https://drop.example" }],
    ["POST", "/api/apps", { ...cookie }],
    ["POST", "/api/apps", { "sec-fetch-site": "cross-site", origin: "https://agent.example" }],
    ["GET", "/api/drops/x", { ...cookie, "sec-fetch-site": "cross-site" }],
    ["POST", "/mcp", { ...cookie, origin: "https://evil.example" }],
  ]
  for (const [method, path, headers] of allowed)
    assert.equal(
      writesMiddleware(request(`https://drop.example${path}`, { method, headers })),
      undefined,
      `${method} ${path}`,
    )
})

test("apps and HTML docs carry the content origin; other kinds don't", async () => {
  insertDrop("page", { kind: "html", filename: "page.html", blob_key: "page.html" })
  insertDrop("notes")
  insertDrop("app", { kind: "app", filename: "app", blob_key: null })
  for (const [id, expected] of [
    ["page", "https://drop-usercontent.example"],
    ["notes", undefined],
    ["app", "https://drop-usercontent.example"],
  ]) {
    const event = request(`https://drop.example/api/drops/${id}`)
    event.context.params = { id }
    assert.equal((await detailHandler(event)).contentOrigin, expected, id)
  }
  state.contentOrigin = ""
  const event = request("https://drop.example/api/drops/app")
  event.context.params = { id: "app" }
  assert.equal((await detailHandler(event)).contentOrigin, undefined)
})

test("an app's own origin serves its files to a frame holding its grant, and to nobody else", async () => {
  state.contentOrigin = "https://*-drop.example"
  state.authSecret = "test-secret"
  try {
    insertDrop("app", { kind: "app", filename: "app/", blob_key: null, link: "applink" })
    insertDrop("other", { kind: "app", filename: "other/", blob_key: null, link: "otherlink" })
    const font = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0xff, 0x00])
    for (const [path, body] of [
      ["index.html", '<script type="module" src="/_nuxt/entry.js"></script>'],
      ["_nuxt/entry.js", "export default 1"],
      ["_nuxt/inter.woff2", font],
      ["docs/index.html", "<p>Docs</p>"],
    ]) {
      const key = `apps/app/publish-1/${path}`
      objects.set(key, { body: new Blob([body]), uploadedAt: new Date() })
      sql
        .prepare("INSERT INTO drop_files (drop_id, path, blob_key, size) VALUES (?, ?, ?, ?)")
        .run("app", path, key, typeof body === "string" ? body.length : body.byteLength)
    }

    const detailEvent = request("https://drop.example/api/drops/app")
    detailEvent.context.params = { id: "app" }
    const detail = await detailHandler(detailEvent)
    assert.match(detail.contentOrigin, /^https:\/\/[a-z2-7]{26}-drop\.example$/)
    assert.deepEqual(Object.keys(detail.files).sort(), ["docs/index.html", "index.html"], "only its pages")
    assert.equal(detail.sizes["_nuxt/inter.woff2"], font.byteLength)
    assert.match(detail.contentGrant, /^v2\.[\w-]+$/)

    const origin = detail.contentOrigin
    const load = (path, { grant = detail.contentGrant, dest = "script", headers = {} } = {}) =>
      contentMiddleware(
        request(`${origin}${path}`, {
          headers: {
            "sec-fetch-dest": dest,
            ...(grant ? { cookie: `theme=dark; drop_grant=${grant}` } : {}),
            ...headers,
          },
        }),
      )

    const script = await load("/_nuxt/entry.js")
    assert.equal(script.status, 200)
    assert.equal(await script.text(), "export default 1")
    assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8")
    assert.equal(script.headers.get("x-content-type-options"), "nosniff")
    const etag = script.headers.get("etag")
    assert.equal((await load("/_nuxt/entry.js", { headers: { "if-none-match": etag } })).status, 304)

    const woff = await load("/_nuxt/inter.woff2", { dest: "font" })
    assert.equal(woff.headers.get("content-type"), "font/woff2")
    assert.deepEqual(new Uint8Array(await woff.arrayBuffer()), font, "binary files come back byte for byte")
    assert.equal(
      await (await load("/docs/", { dest: "empty" })).text(),
      "<p>Docs</p>",
      "a folder serves its index.html",
    )

    assert.equal((await load("/_nuxt/entry.js", { grant: null })).status, 404, "no grant, no file")
    assert.equal((await load("/_nuxt/missing.js")).status, 404)
    assert.match(
      await (await load("/_nuxt/entry.js", { dest: "iframe" })).text(),
      /document\.write/,
      "frames get the host",
    )

    const otherEvent = request("https://drop.example/api/drops/other")
    otherEvent.context.params = { id: "other" }
    const other = await detailHandler(otherEvent)
    assert.equal((await load("/_nuxt/entry.js", { grant: other.contentGrant })).status, 404, "another app's grant")
    assert.equal((await load("/_nuxt/entry.js", { grant: `${detail.contentGrant}x` })).status, 404, "a changed grant")

    sql.prepare("UPDATE drops SET trashed_at = ? WHERE id = 'app'").run(Date.now())
    assert.equal((await load("/_nuxt/entry.js")).status, 404, "nothing once it's in the Trash")
  } finally {
    state.authSecret = undefined
  }
})

test("the frame host keeps the viewer's grant as a cookie before it writes the page, and only a well-formed one", () => {
  const script = FRAME_HOST_HTML.match(/<script>([\s\S]*)<\/script>/)[1]
  const run = (grant) => {
    const cookies = []
    const written = []
    let onMessage
    const parent = { postMessage() {} }
    runInNewContext(script, {
      parent,
      window: {},
      isSecureContext: true,
      location: { protocol: "https:", pathname: "/" },
      addEventListener: (_type, handler) => (onMessage = handler),
      document: {
        body: {},
        set cookie(value) {
          cookies.push(value)
        },
        open: () => written.push(`open after ${cookies.length} cookies`),
        write() {},
        close() {},
      },
    })
    onMessage({ source: parent, data: { __drop: true, type: "document", html: "<p>", grant } })
    return { cookies, written }
  }
  const { cookies, written } = run("v2.abc-DEF_123")
  assert.deepEqual(cookies, ["drop_grant=v2.abc-DEF_123; Path=/; Max-Age=43200; Secure; SameSite=None; Partitioned"])
  assert.deepEqual(written, ["open after 1 cookies"])
  assert.deepEqual(run("v2.x; Domain=vitehub.dev").cookies, [], "nothing that could add cookie attributes")
  assert.deepEqual(run(undefined).cookies, [])
})

test("an app on a shared content origin or none gets no grant, and its text files for the viewer to inline", async () => {
  insertDrop("app", { kind: "app", filename: "app/", blob_key: null, link: "applink" })
  for (const [path, body] of [
    ["index.html", "<p>Hi</p>"],
    ["logo.png", "PNG"],
  ]) {
    objects.set(`apps/app/p/${path}`, { body: new Blob([body]), uploadedAt: new Date() })
    sql
      .prepare("INSERT INTO drop_files (drop_id, path, blob_key, size) VALUES (?, ?, ?, 3)")
      .run("app", path, `apps/app/p/${path}`)
  }
  const event = request("https://drop.example/api/drops/app")
  event.context.params = { id: "app" }
  const detail = await detailHandler(event)
  assert.equal(detail.contentGrant, undefined)
  assert.deepEqual(Object.keys(detail.files), ["index.html"], "binary files aren't read as text")
  assert.deepEqual(detail.paths, ["index.html", "logo.png"])
})

test("app pages map to the URLs a static host serves them at", () => {
  const pages = ["index.html", "about.html", "product/index.html", "docs/a b/index.html"]
  for (const [path, page] of [
    ["/", "index.html"],
    ["", "index.html"],
    ["/product/", "product/index.html"],
    ["/product", "product/index.html"],
    ["/about", "about.html"],
    ["/about.html", "about.html"],
    ["/docs/a b/", "docs/a b/index.html"],
    ["/missing", null],
  ])
    assert.equal(pageAt(pages, path), page, path)
  assert.equal(pageUrl("index.html"), "/")
  assert.equal(pageUrl("product/index.html"), "/product/")
  assert.equal(pageUrl("about.html"), "/about.html")
  assert.equal(pageUrl("docs/a b/index.html"), "/docs/a%20b/")
  for (const page of pages) assert.equal(pageAt(pages, decodeURI(pageUrl(page))), page)
})

test("Drop's scripts go first in the head without dropping the page out of standards mode", () => {
  assert.equal(
    prependToHead("<!doctype html><html><head><title>x</title></head></html>", "<x>"),
    "<!doctype html><html><head><x><title>x</title></head></html>",
  )
  assert.equal(prependToHead("<!DOCTYPE html><p>hi", "<x>"), "<!DOCTYPE html><x><p>hi")
  assert.equal(prependToHead("<p>hi", "<x>"), "<x><p>hi")
  const app = injectRuntime(
    buildProjectDocument(
      {
        "index.html": '<!doctype html><html><head></head><body><a href="/about/">About</a></body></html>',
        "about/index.html": "",
      },
      "index.html",
    ),
    false,
  )
  assert.ok(app.startsWith("<!doctype html>"))
  assert.ok(
    app.indexOf('if (self.origin !== "null") return;') < app.indexOf("const pageAt"),
    "the opaque shim runs before the app runtime",
  )
})

/** Runs the shim in a window whose storage, cookies, and URL changes throw, like an opaque-origin sandbox. */
function opaqueWindow(origin = "null") {
  const insecure = () => {
    throw new Error("The operation is insecure.")
  }
  const calls = []
  const history = {
    pushState(state, title, url) {
      if (url !== undefined) insecure()
      calls.push(["push", state])
    },
    replaceState(state, title, url) {
      if (url !== undefined) insecure()
      calls.push(["replace", state])
    },
  }
  const document = {}
  Object.defineProperty(document, "cookie", { configurable: true, get: insecure, set: insecure })
  const window = { history, document, self: { origin }, calls }
  window.window = window
  for (const name of ["localStorage", "sessionStorage"])
    Object.defineProperty(window, name, { configurable: true, get: insecure })
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
  assert.deepEqual(window.calls, [
    ["push", { page: 2 }],
    ["replace", { page: 3 }],
  ])
})

test("on a real origin the shim leaves the browser's own storage alone", () => {
  assert.throws(() => opaqueWindow("https://drop-usercontent.example").localStorage)
})
