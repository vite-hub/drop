import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"

const SITE = "https://site.test"
const DROP = "https://drop.test"

const html = `<!doctype html><html><head><style>
  body { margin: 0; padding: 40px; font: 16px/1.5 sans-serif; height: 3000px; }
</style></head><body>
  <h1 id="price">Pro costs 12 € a month</h1>
  <p>Billed yearly.</p>
  <script src="${DROP}/review.js" defer></script>
</body></html>`

// The screenshot module, stubbed: a white viewport, so the test needs no network and the strokes are all that's drawn.
const SCREENSHOT_STUB = `export async function createContext() { return {}; }
export async function domToBlob() {
  const canvas = document.createElement("canvas");
  canvas.width = innerWidth; canvas.height = innerHeight;
  const g = canvas.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}`

const CORS = {
  "access-control-allow-origin": SITE,
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PATCH",
}

async function open(browser) {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } })
  // The toolbar's shadow root is closed; opened here so the test can reach its buttons. A connected reviewer, and every
  // form the script sends, kept for the test to read.
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
      window.sent = []
      window.pageKeys = []
      addEventListener("keydown", (e) => window.pageKeys.push(e.key))
      const send = window.fetch
      window.fetch = (url, init) => {
        if (init && init.body instanceof FormData) window.sent.push(init.body)
        return send(url, init)
      }
    },
    { drop: DROP },
  )
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === "esm.sh")
      return route.fulfill({
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: SCREENSHOT_STUB,
      })
    if (url.origin === SITE) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html })
    if (url.origin !== DROP) return route.abort()
    if (url.pathname === "/review.js") return route.fulfill({ contentType: "text/javascript", body: REVIEW_SCRIPT })
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS })
    const body = route.request().method() === "POST" ? { n: 1 } : { threads: [] }
    return route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify(body) })
  })
  const page = await context.newPage()
  await page.goto(SITE + "/pricing")
  await page.locator("drop-review").getByRole("button", { name: "Highlight" }).waitFor()
  return { context, page, ui: page.locator("drop-review") }
}

async function drag(page, from, to) {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  for (let i = 1; i <= 8; i++)
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / 8, from[1] + ((to[1] - from[1]) * i) / 8)
  await page.mouse.up()
}

test("Highlight draws on the page and sends the screenshot with the strokes, anchored to what's under them", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui } = await open(browser)
    await ui.getByRole("button", { name: "Highlight" }).click()
    const done = ui.getByRole("button", { name: "Done" })
    assert.equal(await done.isDisabled(), true, "nothing to send before a stroke")
    assert.equal(await ui.getByRole("button", { name: "Marker" }).getAttribute("aria-pressed"), "true")

    const box = await page.locator("#price").boundingBox()
    const y = box.y + box.height / 2
    await drag(page, [box.x + 10, y], [box.x + 200, y])
    // A tip's key is Highlight's, not the page's.
    await page.keyboard.press("a")
    assert.equal(await ui.getByRole("button", { name: "Arrow" }).getAttribute("aria-pressed"), "true")
    assert.deepEqual(await page.evaluate(() => window.pageKeys), [])
    // The page holds still under the strokes.
    await page.mouse.wheel(0, 400)
    assert.equal(await page.evaluate(() => scrollY), 0)

    await done.click()
    const note = ui.getByRole("textbox", { name: "Comment" })
    await note.waitFor()
    assert.equal(await ui.locator(".ink path").count(), 1, "the strokes stay while the note is written")
    await note.fill("Should be 10 €")
    await ui.getByRole("button", { name: "Send" }).click()
    await page.waitForFunction(() => window.sent.length === 1)

    const sent = await page.evaluate(
      async ([x, y]) => {
        const form = window.sent[0]
        const shot = form.get("screenshot")
        const image = await createImageBitmap(shot)
        const canvas = document.createElement("canvas")
        canvas.width = image.width
        canvas.height = image.height
        const g = canvas.getContext("2d")
        g.drawImage(image, 0, 0)
        const k = image.width / innerWidth
        return {
          data: JSON.parse(form.get("data")),
          type: shot.type,
          under: Array.from(g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data),
          away: Array.from(g.getImageData(5, 5, 1, 1).data),
        }
      },
      [box.x + 100, y],
    )
    assert.equal(sent.data.body, "Should be 10 €")
    assert.equal(sent.data.selector, "#price")
    assert.match(sent.data.label, /^h1 "Pro costs/)
    assert.ok(sent.data.ow > 0 && sent.data.oh > 0)
    assert.match(sent.type, /^image\/(webp|jpeg)$/)
    // The marker's pink, multiplied onto the white page, under the stroke; the rest stays white.
    assert.ok(sent.under[1] < 215 && sent.under[0] > 230, `pink under the marker, got ${sent.under}`)
    assert.deepEqual(sent.away.slice(0, 3), [255, 255, 255])
    assert.equal(await ui.locator(".ink path").count(), 0, "sending clears the strokes")
    assert.equal(await ui.getByRole("button", { name: "Highlight" }).isVisible(), true)
  } finally {
    await browser.close()
  }
})

test("Esc and Undo take strokes back", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui } = await open(browser)
    await ui.getByRole("button", { name: "Highlight" }).click()
    await drag(page, [100, 100], [300, 100])
    await page.keyboard.press("a")
    await drag(page, [100, 300], [300, 200])
    // An arrow too short to point anywhere isn't kept.
    await drag(page, [400, 400], [404, 402])
    assert.equal(await ui.locator(".ink path").count(), 2)
    await page.keyboard.press("Control+z")
    assert.equal(await ui.locator(".ink path").count(), 1)
    await page.keyboard.press("Escape")
    assert.equal(await ui.locator(".ink path").count(), 0)
    assert.equal(await ui.getByRole("button", { name: "Done" }).isVisible(), false)
    assert.equal(await ui.getByRole("button", { name: "Highlight" }).isVisible(), true)
    // Only the modifier itself reaches the page.
    assert.deepEqual(await page.evaluate(() => window.pageKeys), ["Control"])
  } finally {
    await browser.close()
  }
})
