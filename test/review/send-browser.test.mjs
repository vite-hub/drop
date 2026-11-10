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

// A screenshot that takes as long as the test says: it finishes when the page calls window.finishShot().
const SLOW_SCREENSHOT = `export async function createContext() { return {}; }
export async function domToBlob() {
  await new Promise((resolve) => { window.finishShot = resolve; });
  const canvas = document.createElement("canvas");
  canvas.width = 10; canvas.height = 10;
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}`

const CORS = {
  "access-control-allow-origin": SITE,
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PATCH",
}

/** A fake Drop that holds each POST until the test answers it with `reply(status, body)`. */
async function open(browser) {
  const drop = { gets: 0, posts: [], answer: null }
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
        body: SLOW_SCREENSHOT,
      })
    if (url.origin === SITE) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html })
    if (url.origin !== DROP) return route.abort()
    if (url.pathname === "/review.js") return route.fulfill({ contentType: "text/javascript", body: REVIEW_SCRIPT })
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS })
    if (request.method() === "POST") {
      const data = JSON.parse(
        request
          .postDataBuffer()
          .toString("latin1")
          .match(/\{"body".*?\}(?=\r\n)/)[0],
      )
      const { status, body } = await new Promise((resolve) => drop.posts.push({ data, reply: resolve }))
      return route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) })
    }
    drop.gets++
    return route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify({ threads: [] }) })
  })
  const page = await context.newPage()
  await page.goto(SITE + "/pricing")
  const ui = page.locator("drop-review")
  await ui.getByRole("button", { name: "Comment" }).waitFor()
  return { drop, page, ui }
}

async function comment(page, ui, words) {
  await ui.getByRole("button", { name: "Comment" }).click()
  await page.mouse.click(120, 60)
  await ui.getByRole("textbox", { name: "Comment" }).fill(words)
  await ui.getByRole("button", { name: "Send" }).click()
}

const thread = (n, data) => ({
  n,
  requestId: data.requestId,
  body: data.body,
  author: { name: "Ada", image: null },
  createdAt: Date.now(),
  resolved: false,
  mine: true,
  canResolve: true,
  page: data.page,
  element: { selector: data.selector, label: data.label },
  spot: data.spot,
  box: { ox: data.ox, oy: data.oy, ow: data.ow, oh: data.oh },
  screenshot: null,
  images: [],
  replies: [],
})

test("a sent comment's pin shows before its screenshot and Drop's answer, and the answer draws it", async () => {
  const browser = await chromium.launch()
  try {
    const { drop, page, ui } = await open(browser)
    const gets = drop.gets
    await comment(page, ui, "Should be 10 €")
    // The screenshot is still drawing and nothing has reached Drop, yet the pin is there and the composer is gone.
    const sending = ui.getByRole("button", { name: "Sending your comment" })
    await sending.waitFor({ state: "attached" })
    assert.equal(await ui.locator(".pop").isHidden(), true)
    assert.equal(drop.posts.length, 0)
    // Nothing else opens while it's on its way: the note stays for a send that fails.
    await ui.getByRole("button", { name: "Comment", exact: true }).click()
    await ui.getByText("Sending your comment…").waitFor()

    await page.evaluate(() => window.finishShot())
    while (!drop.posts.length) await page.waitForTimeout(10)
    const [post] = drop.posts
    post.reply({ status: 200, body: { n: 3, thread: thread(3, post.data) } })
    await ui.getByRole("button", { name: "Comment #3 by Ada" }).waitFor({ state: "attached" })
    await ui.getByText("Sent as #3.").waitFor()
    assert.equal(await sending.count(), 0)
    assert.equal(drop.gets, gets, "the answer's thread draws the pin; no second request")
  } finally {
    await browser.close()
  }
}, 20_000)

test("a send Drop refuses takes its pin away and opens the composer again with the note", async () => {
  const browser = await chromium.launch()
  try {
    const { drop, page, ui } = await open(browser)
    await comment(page, ui, "Should be 10 €")
    await ui.getByRole("button", { name: "Sending your comment" }).waitFor({ state: "attached" })
    await page.evaluate(() => window.finishShot())
    while (!drop.posts.length) await page.waitForTimeout(10)
    drop.posts[0].reply({ status: 429, body: { message: "Too many comments. Try again in a minute." } })
    await ui.getByText("Too many comments. Try again in a minute.").waitFor()
    assert.equal(await ui.locator(".pop").isVisible(), true)
    assert.equal(await ui.getByRole("textbox", { name: "Comment" }).inputValue(), "Should be 10 €")
    assert.equal(await ui.locator(".pin").count(), 0)

    // Sending again works from the same composer.
    await ui.getByRole("button", { name: "Send" }).click()
    while (drop.posts.length < 2) await page.waitForTimeout(10)
    drop.posts[1].reply({ status: 200, body: { n: 4, thread: thread(4, drop.posts[1].data) } })
    await ui.getByRole("button", { name: "Comment #4 by Ada" }).waitFor({ state: "attached" })
  } finally {
    await browser.close()
  }
}, 20_000)
