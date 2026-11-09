import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { parseFrameMessage } from "../../shared/frame-messages.ts"
import { injectRuntime } from "../../shared/plan-runtime.ts"

const html = `<!doctype html><html><head><style>body { margin: 0; font: 16px/1.5 sans-serif; }
  #box { margin: 100px 0 0 100px; width: 400px; height: 200px; background: #eee; }
  #tall { height: 2000px; }</style></head><body><div id="box">A box</div><div id="tall"></div></body></html>`

async function open(browser) {
  const escaped = injectRuntime(html, false, 0, true).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } })
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== "drop.test") return route.abort()
    return route.fulfill({
      contentType: "text/html",
      body: `<style>body{margin:0}iframe{border:0;width:100vw;height:600px;display:block}</style>
        <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escaped}"></iframe>
        <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data); });
        window.send = (message) => document.querySelector("iframe").contentWindow.postMessage({ __drop: true, ...message }, "*");</script>`,
    })
  })
  const page = await context.newPage()
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => posts.some((m) => m.type === "ready"), null, { timeout: 5000 })
  return { context, page, frame: page.frames()[1] }
}

const BEN = { key: "2", name: "Ben", color: "#E11D48", selector: "#box", x: 500, y: 500 }
const cursors = (frame) =>
  frame.evaluate(() =>
    [...document.querySelector("drop-comments").shadowRoot.querySelectorAll(".pc")].map((node) => {
      const at = new DOMMatrix(getComputedStyle(node).transform)
      return { name: node.textContent, x: at.m41, y: at.m42, off: node.classList.contains("off"), ink: node.style.getPropertyValue("--pc-ink") }
    }),
  )

test("a doc's frame draws the others' cursors on their elements, and shares the reader's only when asked", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch()
  try {
    const { context, page, frame } = await open(browser)

    // Alone, the reader's pointer stays in the frame.
    await page.mouse.move(150, 150)
    await page.waitForTimeout(150)
    assert.equal(await page.evaluate(() => posts.filter((m) => m.type === "pointer").length), 0)

    // Ben is in the middle of the box: (100 + 200, 100 + 100).
    await page.evaluate((ben) => send({ type: "cursors", cursors: [ben], share: true }), BEN)
    await frame.waitForFunction(() => document.querySelector("drop-comments").shadowRoot.querySelector(".pc"))
    await page.waitForTimeout(250)
    const [ben] = await cursors(frame)
    assert.equal(ben.name, "Ben")
    assert.ok(Math.abs(ben.x - 300) < 2 && Math.abs(ben.y - 200) < 2, `Ben's cursor at the box's middle, got ${ben.x},${ben.y}`)
    assert.equal(ben.off, false)
    assert.equal(ben.ink, "#fff", "white reads better on rose")

    // Now the reader's pointer goes up, as the box and the spot in it, and Drop's parser takes it.
    await page.mouse.move(200, 150)
    const pointer = await page.waitForFunction(() => posts.findLast((m) => m.type === "pointer" && m.at), null, { timeout: 3000 })
    const message = await pointer.jsonValue()
    assert.deepEqual(message.at, { selector: "#box", x: 250, y: 250 })
    assert.deepEqual(parseFrameMessage(message), { type: "pointer", at: { selector: "#box", x: 250, y: 250 } })
    // At most every 50 ms, however fast it moves.
    const sentBefore = await page.evaluate(() => posts.filter((m) => m.type === "pointer").length)
    for (let x = 200; x < 400; x += 4) await page.mouse.move(x, 160)
    const sent = (await page.evaluate(() => posts.filter((m) => m.type === "pointer").length)) - sentBefore
    assert.ok(sent < 50 && sent > 0, `throttled to a few updates, got ${sent}`)

    // Scrolling the doc moves Ben's cursor with his box, and hides it once the box is off screen.
    await frame.evaluate(() => scrollTo(0, 120))
    await page.waitForTimeout(250)
    assert.ok(Math.abs((await cursors(frame))[0].y - 80) < 2)
    await frame.evaluate(() => scrollTo(0, 900))
    await page.waitForTimeout(250)
    assert.equal((await cursors(frame))[0].off, true)

    // Someone on an element the page doesn't have shows nowhere; a cursor that's gone is removed.
    await page.evaluate((ben) => send({ type: "cursors", cursors: [{ ...ben, selector: "#nope" }], share: true }), BEN)
    await page.waitForTimeout(100)
    assert.equal((await cursors(frame))[0].off, true)
    await page.evaluate(() => send({ type: "cursors", cursors: [], share: false }))
    await page.waitForTimeout(100)
    assert.deepEqual(await cursors(frame), [])

    // Malformed cursors, as anything could post, are left out.
    await page.evaluate(() => send({ type: "cursors", cursors: [{ key: 1, name: "x" }, null, "y"], share: false }))
    await page.waitForTimeout(100)
    assert.deepEqual(await cursors(frame), [])
    await context.close()
  } finally {
    await browser.close()
  }
})

test("a cursor's name fades once it stays still, and comes back when it moves", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch()
  try {
    const { context, page, frame } = await open(browser)
    await page.evaluate((ben) => send({ type: "cursors", cursors: [ben], share: false }), BEN)
    const still = () =>
      frame.evaluate(() => document.querySelector("drop-comments").shadowRoot.querySelector(".pc").classList.contains("still"))
    await frame.waitForFunction(() => document.querySelector("drop-comments").shadowRoot.querySelector(".pc"))
    assert.equal(await still(), false)
    await page.waitForTimeout(3200)
    assert.equal(await still(), true)
    await page.evaluate((ben) => send({ type: "cursors", cursors: [{ ...ben, x: 600 }], share: false }), BEN)
    await page.waitForTimeout(50)
    assert.equal(await still(), false)
    await context.close()
  } finally {
    await browser.close()
  }
})
