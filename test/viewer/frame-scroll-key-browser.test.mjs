import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { frameScrollKey } from "../../app/utils/frame-scroll-key.ts"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

// Drop's window, cut down to what holds focus under Comments: the Comments button, a composer, and the comments list.
// Its keydown listener is useViewerFrame's, passing the keys frameScrollKey lets through to the real comment layer.
async function open(browser) {
  const doc = planDocument("html", "<!doctype html><style>body { height: 5000px; margin: 0 }</style><p>Long page</p>")
  const escaped = doc.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const rows = Array.from({ length: 30 }, (_, i) => `<p>Comment ${i}</p>`).join("")
  const context = await browser.newContext({ viewport: { width: 900, height: 600 }, reducedMotion: "reduce" })
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "drop.test") return route.abort()
    return route.fulfill({
      contentType: "text/html",
      body: `<style>body { margin: 0; overflow: hidden } iframe { border: 0; width: 600px; height: 600px }
          #list { position: fixed; right: 0; top: 0; width: 280px; height: 200px; overflow-y: auto }</style>
        <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escaped}"></iframe>
        <button id="comments">Comments</button><textarea id="composer"></textarea>
        <section id="list"><button id="row">Thread</button>${rows}</section>
        <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data) });
          window.tell = (message) => frames[0].postMessage({ __drop: true, ...message }, "*");
          const frameScrollKey = ${frameScrollKey.toString()};
          addEventListener("keydown", (event) => { const scroll = frameScrollKey(event); if (scroll) tell({ type: "scroll-key", ...scroll }) });
          document.getElementById("comments").addEventListener("click", () => (window.pressed = (window.pressed || 0) + 1));</script>`,
    })
  })
  const page = await context.newPage()
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  const frame = page.frames()[1]
  return { page, frame, scrollY: () => frame.evaluate(() => scrollY) }
}

test("scroll keys in Drop's window scroll the page while the Comments button keeps focus", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame, scrollY } = await open(browser)
    await page.evaluate(() => tell({ type: "tool", tool: "comment" }))
    await frame.waitForFunction(() => document.querySelector("drop-comments").shadowRoot.querySelector(".draw"))
    await page.focus("#comments")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await frame.waitForFunction(() => scrollY === 80)
    await page.keyboard.press("PageDown")
    await frame.waitForFunction(() => scrollY === 80 + 600 * 0.875)
    await page.keyboard.press("ArrowUp")
    await frame.waitForFunction(() => scrollY === 40 + 600 * 0.875)
    await page.keyboard.press("End")
    await frame.waitForFunction(() => scrollY === document.scrollingElement.scrollHeight - innerHeight)
    await page.keyboard.press("Home")
    await frame.waitForFunction(() => scrollY === 0)
    // Space presses the focused button, and only scrolls with nothing focused.
    await page.keyboard.press("Space")
    await page.waitForTimeout(200)
    assert.equal(await scrollY(), 0)
    assert.equal(await page.evaluate(() => window.pressed), 1)
    await page.evaluate(() => document.activeElement.blur())
    await page.keyboard.press("Space")
    await frame.waitForFunction(() => scrollY === 600 * 0.875)
    await page.keyboard.press("Shift+Space")
    await frame.waitForFunction(() => scrollY === 0)
  } finally {
    await browser.close()
  }
})

test("keys Drop's window uses, and the Marker's lock, keep the page still", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame, scrollY } = await open(browser)
    await page.focus("#composer")
    for (const key of ["ArrowDown", "PageDown", "End", "Space"]) await page.keyboard.press(key)
    // The comments list scrolls itself.
    await page.focus("#row")
    await page.keyboard.press("PageDown")
    await page.waitForFunction(() => document.getElementById("list").scrollTop > 0)
    // A modal over the page.
    await page.focus("#comments")
    await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<div id="modal" aria-modal="true"></div>'))
    await page.keyboard.press("ArrowDown")
    await page.evaluate(() => document.getElementById("modal").remove())
    // The Marker holds the page still for its screenshot and strokes.
    await page.evaluate(() => tell({ type: "tool", tool: "mark" }))
    await frame.waitForFunction(() => document.querySelector("drop-comments").shadowRoot.querySelector(".draw.mark"))
    await page.keyboard.press("PageDown")
    await page.waitForTimeout(250)
    assert.equal(await scrollY(), 0)
    // Its composer's text has the keys.
    assert.equal(await page.evaluate(() => document.getElementById("composer").value), " ")
  } finally {
    await browser.close()
  }
})
