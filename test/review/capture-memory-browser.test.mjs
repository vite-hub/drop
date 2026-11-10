import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"

// drop#163: Chromium keeps every SVG image it decodes until the tab closes, and each comment's screenshot is one. On a
// long table that SVG was 34 MB, and the tab grew by about 65 MB per comment.
const SITE = "https://site.test"
const DROP = "https://drop.test"
// The module review.js loads from esm.sh, from node_modules, so the screenshot is drawn as it is on a reviewer's page.
const SCREENSHOT_MODULE = readFileSync(new URL(import.meta.resolve("modern-screenshot")), "utf8")

const TABLE = `<style>body { margin: 0; font: 14px system-ui } td { padding: 4px 8px; border-bottom: 1px solid #eee }</style>
<table><tbody>${Array.from({ length: 1500 }, (_, i) => `<tr><td><span>SKU-${i}</span></td><td><div><span>${(i * 37) % 1000}</span></div></td><td><button>Edit</button></td></tr>`).join("")}</tbody></table>`

const CORS = {
  "access-control-allow-origin": SITE,
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PATCH",
}

async function open(browser, body, threads = []) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
  await context.addInitScript(
    ({ drop }) => {
      const { value: attach } = Object.getOwnPropertyDescriptor(Element.prototype, "attachShadow")
      Element.prototype.attachShadow = function (init) {
        return Reflect.apply(attach, this, [{ ...init, mode: "open" }])
      }
      sessionStorage.setItem(
        "drop-review:" + drop,
        JSON.stringify({ token: "t", expiresAt: Date.now() + 3600_000, name: "Ada" }),
      )
      // The length of each SVG an <img> decodes, and the object URLs still open.
      window.svgs = []
      const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src")
      Object.defineProperty(HTMLImageElement.prototype, "src", {
        ...src,
        set(value) {
          if (String(value).startsWith("data:image/svg")) window.svgs.push(String(value).length)
          src.set.call(this, value)
        },
      })
      // Comments Drop has answered; the composer can close before that.
      window.answered = 0
      const send = window.fetch
      window.fetch = (url, init) => {
        const response = send(url, init)
        if (init && init.body instanceof FormData) void response.then(() => window.answered++)
        return response
      }
      window.urls = new Set()
      const create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL)
      URL.createObjectURL = (blob) => {
        const url = create(blob)
        window.urls.add(url)
        return url
      }
      URL.revokeObjectURL = (url) => {
        window.urls.delete(url)
        revoke(url)
      }
    },
    { drop: DROP },
  )
  await context.route("**/*", (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.hostname === "esm.sh")
      return route.fulfill({
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: SCREENSHOT_MODULE,
      })
    if (url.origin === SITE)
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><body>${body}<script src="${DROP}/review.js" defer></script></body></html>`,
      })
    if (url.origin !== DROP) return route.abort()
    if (url.pathname === "/review.js") return route.fulfill({ contentType: "text/javascript", body: REVIEW_SCRIPT })
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS })
    if (url.pathname.startsWith("/api/review/images/"))
      return route.fulfill({ contentType: "image/png", headers: CORS, body: Buffer.alloc(16) })
    const answer = request.method() === "POST" ? { n: threads.length + 1 } : { open: threads.length, threads }
    return route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify(answer) })
  })
  const page = await context.newPage()
  await page.goto(SITE + "/")
  const ui = page.locator("drop-review")
  await ui.getByRole("button", { name: "Comment", exact: true }).waitFor()
  return { page, ui }
}

// The resident memory of every renderer once garbage is collected, in MB; null where /proc isn't there to read it.
async function rendererMB(browser, page) {
  const gc = await page.context().newCDPSession(page)
  await gc.send("HeapProfiler.collectGarbage")
  await gc.detach()
  await page.waitForTimeout(1000)
  const cdp = await browser.newBrowserCDPSession()
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo")
  await cdp.detach()
  let kb = 0
  for (const { id, type } of processInfo) {
    if (type !== "renderer") continue
    const status = `/proc/${id}/status`
    if (!existsSync(status)) return null
    kb += Number(readFileSync(status, "utf8").match(/VmRSS:\s+(\d+)/)[1])
  }
  return kb / 1024
}

test("comments on a long table each decode a small screenshot, and the tab's memory stays flat", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui } = await open(browser, TABLE)
    const comment = async (i) => {
      await page.evaluate((y) => scrollTo(0, y), i * 400)
      await ui.getByRole("button", { name: "Comment", exact: true }).click()
      await page.mouse.click(200, 200 + i * 40)
      await ui.getByRole("textbox", { name: "Comment", exact: true }).fill("Note " + i)
      await ui.getByRole("button", { name: "Send" }).click()
      await page.waitForFunction((n) => window.answered === n, i + 1, { polling: 100, timeout: 60_000 })
    }
    // The first two load modern-screenshot and warm the renderer up.
    await comment(0)
    await comment(1)
    const before = await rendererMB(browser, page)
    for (let i = 2; i <= 4; i++) await comment(i)
    const after = await rendererMB(browser, page)

    // Garbage collected, 82 MB on main, about twice each SVG; 7 MB with the styles shared.
    if (before !== null)
      assert.ok(after - before < 40, `the tab grew by ${Math.round(after - before)} MB over 3 comments`)
    const svgs = await page.evaluate(() => window.svgs)
    assert.equal(svgs.length, 5, "one SVG per comment")
    // Each element's style written inline made it 13.8 MB here; as shared classes it's under 1 MB.
    assert.ok(
      Math.max(...svgs) < 2_000_000,
      `each screenshot's SVG is small, got ${svgs.map((n) => (n / 1e6).toFixed(1) + " MB")}`,
    )
  } finally {
    await browser.close()
  }
}, 180_000)

test("a cancelled comment's screenshot stops drawing", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui } = await open(browser, TABLE)
    await ui.getByRole("button", { name: "Comment", exact: true }).click()
    await page.mouse.click(200, 200)
    await ui.getByRole("textbox", { name: "Comment", exact: true }).waitFor()
    await page.keyboard.press("Escape")
    await ui.getByRole("textbox", { name: "Comment", exact: true }).waitFor({ state: "hidden" })
    // Long enough for the clone of 1,500 rows to finish and be drawn, had it gone on.
    await page.waitForTimeout(8000)
    assert.deepEqual(await page.evaluate(() => window.svgs), [], "nothing was drawn for the cancelled comment")
  } finally {
    await browser.close()
  }
}, 60_000)

test("a thread's pictures are let go once it closes", async () => {
  const browser = await chromium.launch()
  try {
    const thread = {
      n: 1,
      body: "See the pictures",
      resolved: false,
      replies: [],
      images: [
        { id: "i1", filename: "one.png" },
        { id: "i2", filename: "two.png" },
      ],
      author: { name: "Ada" },
      element: { selector: "#target", label: "p" },
      spot: { x: 0, y: 0 },
      createdAt: 0,
    }
    const { page, ui } = await open(browser, `<p id="target" style="margin:120px">Target</p>`, [thread])
    const pin = ui.locator(".pin").first()
    await pin.waitFor()
    await pin.click()
    await page.waitForFunction(() => window.urls.size === 2, null, { polling: 100 })
    await page.keyboard.press("Escape")
    await page.waitForFunction(() => window.urls.size === 0, null, { polling: 100, timeout: 5000 })
  } finally {
    await browser.close()
  }
}, 30_000)
