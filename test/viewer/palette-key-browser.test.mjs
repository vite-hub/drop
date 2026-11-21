import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"

// ⌘K opens Drop's palette from Drop's window (Nuxt UI's `meta_k`): ⌘ on a Mac, Ctrl elsewhere. Once a page in a frame
// has the focus, the key goes to the frame, which passes it on.
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36"
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36"

// Each key's event, once its dispatch is over: whether anything took it from the browser.
const RECORD = `<script>window.keys = [];
  addEventListener("keydown", (e) => setTimeout(() => keys.push({ key: e.key, prevented: e.defaultPrevented })));
</script>`
const PAGE = `<!doctype html><html><head><style>body { margin: 0; padding: 40px }</style></head><body>
  <p>A page</p><input id="field" aria-label="Field">${RECORD}</body></html>`

async function openDoc(browser, userAgent, source = PAGE) {
  const escaped = planDocument("html", source).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const context = await browser.newContext({ viewport: { width: 900, height: 600 }, userAgent })
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "drop.test") return route.abort()
    return route.fulfill({
      contentType: "text/html",
      body: `<style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style>
        <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escaped}"></iframe>
        <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data) });</script>`,
    })
  })
  const page = await context.newPage()
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  const frame = page.frames()[1]
  await frame.click("p")
  return { page, frame }
}

// A site open on its own has no Drop around it, and nothing posted.
const paletteKeys = (page) =>
  page.evaluate(() => (window.posts ?? []).filter((m) => m.type === "key" && m.key === "meta_k"))
/** Presses `key` in the frame and says whether Drop heard ⌘K and whether the browser lost the key. */
async function press(page, frame, key) {
  const before = (await paletteKeys(page)).length
  const pressed = (await frame.evaluate(() => keys.length)) + 1
  await page.keyboard.press(key)
  await frame.waitForFunction((n) => keys.length >= n, pressed)
  await page.waitForTimeout(50)
  return {
    posted: (await paletteKeys(page)).length - before,
    prevented: await frame.evaluate(() => keys.at(-1).prevented),
  }
}

test(
  "⌘K in a drop's frame opens Drop's palette on a Mac, from a field in the page too",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch()
    try {
      const { page, frame } = await openDoc(browser, MAC)
      assert.deepEqual(await press(page, frame, "Meta+k"), { posted: 1, prevented: true })
      await frame.focus("#field")
      assert.deepEqual(await press(page, frame, "Meta+k"), { posted: 1, prevented: true })
      // Ctrl+K on a Mac is a field's own key (delete to the line's end), as it is for Nuxt UI's meta_k.
      assert.deepEqual(await press(page, frame, "Control+k"), { posted: 0, prevented: false })
      await frame.click("p")
      assert.deepEqual(await press(page, frame, "k"), { posted: 0, prevented: false })
      assert.deepEqual(await press(page, frame, "Meta+Shift+k"), { posted: 0, prevented: false })
    } finally {
      await browser.close()
    }
  },
)

test(
  "Ctrl+K in a drop's frame opens Drop's palette off a Mac, and keeps the browser's search bar away",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch()
    try {
      const { page, frame } = await openDoc(browser, LINUX)
      assert.deepEqual(await press(page, frame, "Control+k"), { posted: 1, prevented: true })
      assert.deepEqual(await press(page, frame, "Meta+k"), { posted: 0, prevented: false })
      assert.deepEqual(await press(page, frame, "k"), { posted: 0, prevented: false })
    } finally {
      await browser.close()
    }
  },
)

test("a page that uses ⌘K itself keeps it", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch()
  try {
    const own = PAGE.replace(
      "</body>",
      `<script>document.addEventListener("keydown", (e) => { if (e.key === "k" && e.ctrlKey) e.preventDefault() })</script></body>`,
    )
    const { page, frame } = await openDoc(browser, LINUX, own)
    assert.deepEqual(await press(page, frame, "Control+k"), { posted: 0, prevented: true })
  } finally {
    await browser.close()
  }
})

// A reviewed site in Drop's site frame, with the review script, and Drop's window around it, which answers the script's
// "review-ready" as ViewerSiteFrame does unless `answer` is off.
const SITE = "https://site.test"
const DROP = "https://drop.test"
async function openSite(browser, { framed = true, answer = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 }, userAgent: LINUX })
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.origin === SITE)
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><h1>Pro</h1>${RECORD}<script src="${DROP}/review.js"></script>`,
      })
    if (url.origin !== DROP) return route.abort()
    if (url.pathname === "/review.js") return route.fulfill({ contentType: "text/javascript", body: REVIEW_SCRIPT })
    if (url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe src="${SITE}/"></iframe>
          <script>window.posts = []; addEventListener("message", (e) => {
            if (e.origin !== "${SITE}" || !e.data?.__drop) return;
            window.posts.push(e.data);
            if (e.data.type === "review-ready" && ${answer}) e.source.postMessage({ __drop: true, type: "hello" }, e.origin);
          });</script>`,
      })
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
      headers: { "access-control-allow-origin": "*" },
    })
  })
  const page = await context.newPage()
  await page.goto(framed ? `${DROP}/` : `${SITE}/`)
  const frame = framed ? page.frames()[1] : page.mainFrame()
  await frame.waitForFunction(() => document.querySelector("drop-review"))
  if (framed)
    await page.waitForFunction(() => window.posts.some((m) => m.type === "review-ready"), undefined, { timeout: 5000 })
  await page.waitForTimeout(100)
  await frame.click("h1")
  return { page, frame }
}

test("Ctrl+K on a reviewed site in Drop's frame opens Drop's palette", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await openSite(browser)
    assert.deepEqual(await press(page, frame, "Control+k"), { posted: 1, prevented: true })
    assert.deepEqual(await press(page, frame, "k"), { posted: 0, prevented: false })
  } finally {
    await browser.close()
  }
})

test("a reviewed site keeps Ctrl+K on its own, or in a frame that isn't Drop's", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch()
  try {
    const alone = await openSite(browser, { framed: false })
    assert.deepEqual(await press(alone.page, alone.frame, "Control+k"), { posted: 0, prevented: false })
    const elsewhere = await openSite(browser, { answer: false })
    assert.deepEqual(await press(elsewhere.page, elsewhere.frame, "Control+k"), { posted: 0, prevented: false })
  } finally {
    await browser.close()
  }
})

// Z, zen mode, is one of the pill's keys the frame passes on, like V or U: never from a field, never with ⌘ or Ctrl.
test("Z in a drop's frame toggles Drop's zen mode, but not from a field", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await openDoc(browser, LINUX)
    const zKeys = () => page.evaluate(() => window.posts.filter((m) => m.type === "key" && m.key === "z").length)
    await page.keyboard.press("z")
    await page.waitForFunction(() => window.posts.some((m) => m.type === "key" && m.key === "z"), undefined, {
      timeout: 5000,
    })
    assert.equal(await zKeys(), 1)
    await page.keyboard.press("Control+z")
    await frame.focus("#field")
    await page.keyboard.press("z")
    await page.waitForTimeout(100)
    assert.equal(await zKeys(), 1)
  } finally {
    await browser.close()
  }
})
