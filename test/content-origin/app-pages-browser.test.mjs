import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { H3Event } from "h3"
import { insertDrop, migrate, objects, reset, sql, state } from "../cost/harness.mjs"
import { CONTENT_SANDBOX } from "../../app/utils/feedback.ts"

const { default: contentMiddleware } = await import("../../server/middleware/0.05.content-origin.ts")
const { default: detailHandler } = await import("../../server/api/drops/[id].get.ts")
const { buildProjectDocument } = await import("../../shared/project-bundle.ts")
const { injectRuntime } = await import("../../shared/plan-runtime.ts")

migrate()

const event = (url, init) => {
  const created = new H3Event(new Request(url, init))
  created.context.log = { set() {}, error() {} }
  return created
}

/**
 * An app on its own origin, whose drop comes without its pages' HTML: the frame host reads each page on that origin
 * with the viewer's grant, and the viewer writes the document it builds from it. A real browser, the real content
 * origin middleware, and a stand-in for the viewer's side of the messages (useViewerFrame).
 */
test("a served app's frame reads each page on its origin, renders it, and follows a link to the next", async () => {
  reset()
  state.contentOrigin = "https://*-drop.test"
  state.authSecret = "test-secret"
  state.who = { userId: "owner", role: "member" }
  state.identities = { owner: state.who }
  insertDrop("app", { kind: "app", filename: "app/", blob_key: null })
  for (const [path, body] of [
    [
      "index.html",
      '<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><h1>Home</h1><a href="/docs/">Docs</a></body></html>',
    ],
    ["docs/index.html", "<!doctype html><html><head></head><body><h1>Docs</h1></body></html>"],
    ["app.css", "h1 { color: rgb(1, 2, 3) }"],
  ]) {
    objects.set(`apps/app/1/${path}`, { body: new Blob([body]), uploadedAt: new Date() })
    sql
      .prepare("INSERT INTO drop_files (drop_id, path, blob_key, size) VALUES (?, ?, ?, ?)")
      .run("app", path, `apps/app/1/${path}`, body.length)
  }
  const detailEvent = event("https://drop.test/api/drops/app")
  detailEvent.context.params = { id: "app" }
  const detail = await detailHandler(detailEvent)
  assert.equal(detail.files, undefined)
  const origin = detail.contentOrigin
  const appHost = new URL(origin).hostname

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext()
    const served = []
    await context.route("**/*", async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.hostname === "drop.test")
        return route.fulfill({
          contentType: "text/html",
          body: `<iframe sandbox="${CONTENT_SANDBOX}" src="${origin}/"></iframe>
            <script>window.read = [];
              const frame = document.querySelector("iframe");
              const tell = (message) => frame.contentWindow.postMessage({ __drop: true, ...message }, ${JSON.stringify(origin)});
              addEventListener("message", async (e) => {
                if (e.origin !== ${JSON.stringify(origin)} || !e.data?.__drop) return;
                const at = (path) => path.replace(/[?#].*$/, "").replace(/\\/$/, "/index.html").replace(/^\\//, "");
                if (e.data.type === "host") tell({ type: "read", page: at(e.data.path), grant: ${JSON.stringify(detail.contentGrant)} });
                if (e.data.type === "page") { window.read.push(e.data.page); tell({ type: "document", html: await build(e.data.page, e.data.html) }); }
              });</script>`,
        })
      if (url.hostname !== appHost) return route.abort()
      const headers = await request.allHeaders()
      // Playwright leaves partitioned cookies out of an intercepted request's headers: send the frame's own jar.
      headers.cookie ??= (await context.cookies(url.href)).map(({ name, value }) => `${name}=${value}`).join("; ")
      const response = await contentMiddleware(event(url.href, { method: request.method(), headers }))
      served.push(`${response.status} ${url.pathname}`)
      return route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      })
    })
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.exposeFunction("build", (path, html) =>
      injectRuntime(buildProjectDocument({ [path]: html }, path), false, 0, true),
    )
    await page.goto("https://drop.test/")
    const frame = () => page.frames().find((candidate) => candidate.url().startsWith(origin))
    await page.waitForFunction(() => window.read.length === 1)
    await frame().waitForSelector("h1")
    assert.equal(await frame().textContent("h1"), "Home")

    await frame().click("a")
    await page.waitForFunction(() => window.read.length === 2)
    await frame().waitForFunction(() => document.querySelector("h1")?.textContent === "Docs")
    assert.deepEqual(await page.evaluate(() => window.read), ["index.html", "docs/index.html"])
    assert.ok(served.includes("200 /index.html"), served.join(", "))
    assert.ok(served.includes("200 /docs/index.html"), served.join(", "))
    assert.ok(served.includes("200 /app.css"), "the page's other files load from the origin as before")
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
}, 60_000)
