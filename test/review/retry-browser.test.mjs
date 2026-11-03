import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"

const SITE = "https://site.test"
const DROP = "https://drop.test"

const html = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif">
  <h1 id="price">Pro costs 12 € a month</h1>
  <script src="${DROP}/review.js" defer></script>
</body></html>`

const SCREENSHOT_STUB = `export async function createContext() { return {}; }
export async function domToBlob() {
  const canvas = document.createElement("canvas");
  canvas.width = 10; canvas.height = 10;
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}`

const CORS = {
  "access-control-allow-origin": SITE,
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PATCH",
}

/**
 * A fake Drop. `down` makes it answer the way the proxy does while Drop restarts: a 503 without CORS headers, which
 * the browser reports as a failed fetch. `loseAnswer` saves the next comment and then drops the connection.
 */
async function open(browser) {
  const drop = { down: false, loseAnswer: false, posts: 0, saved: [] }
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } })
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
    },
    { drop: DROP },
  )
  await context.route("**/*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.hostname === "esm.sh")
      return route.fulfill({
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: SCREENSHOT_STUB,
      })
    if (url.origin === SITE) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html })
    if (url.origin !== DROP) return route.abort()
    if (url.pathname === "/review.js") return route.fulfill({ contentType: "text/javascript", body: REVIEW_SCRIPT })
    if (drop.down) return route.fulfill({ status: 503, contentType: "text/html", body: "<h1>503</h1>" })
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS })
    if (request.method() === "POST") {
      drop.posts++
      const body = JSON.parse(
        request
          .postDataBuffer()
          .toString("utf8")
          .match(/\{"body".*?\}(?=\r\n)/)[0],
      ).body
      const n = 3 + drop.saved.length
      drop.saved.push({ n, body, resolved: false, replies: [], images: [], author: { name: "Ada" } })
      if (drop.loseAnswer) {
        drop.loseAnswer = false
        return route.abort("connectionreset")
      }
      return route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify({ n }) })
    }
    return route.fulfill({
      contentType: "application/json",
      headers: CORS,
      body: JSON.stringify({ open: drop.saved.length, threads: drop.saved }),
    })
  })
  const page = await context.newPage()
  await page.goto(SITE + "/pricing")
  const ui = page.locator("drop-review")
  await ui.getByRole("button", { name: "Comment" }).waitFor()
  return { drop, page, ui }
}

async function comment(page, ui, words) {
  await ui.getByRole("button", { name: "Comment" }).click()
  await page.mouse.move(60, 50)
  await page.mouse.down()
  await page.mouse.move(200, 80, { steps: 4 })
  await page.mouse.up()
  await ui.getByRole("textbox", { name: "Comment" }).fill(words)
  await ui.getByRole("button", { name: "Send" }).click()
}

test("a comment sent while Drop is down goes through once Drop is back", async () => {
  const browser = await chromium.launch()
  try {
    const { drop, page, ui } = await open(browser)
    drop.down = true
    await comment(page, ui, "Should be 10 €")
    await ui.getByText("Can't reach Drop. Trying again…").waitFor()
    // Drop stays down past the first check, then comes back: the check finds nothing, so the comment is sent again.
    await page.waitForTimeout(2500)
    drop.down = false
    await ui.getByText("Sent as #3.").waitFor({ timeout: 10_000 })
    assert.equal(drop.posts, 1)
    assert.deepEqual(
      drop.saved.map((item) => item.body),
      ["Should be 10 €"],
    )
  } finally {
    await browser.close()
  }
}, 20_000)

test("a comment Drop saved before the answer was lost isn't sent twice", async () => {
  const browser = await chromium.launch()
  try {
    const { drop, page, ui } = await open(browser)
    drop.loseAnswer = true
    await comment(page, ui, "Should be 10 €")
    await ui.getByText("Sent as #3.").waitFor({ timeout: 10_000 })
    assert.equal(drop.posts, 1)
    assert.equal(drop.saved.length, 1)
  } finally {
    await browser.close()
  }
}, 20_000)
