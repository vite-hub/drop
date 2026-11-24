import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { injectRuntime, withVariantBar } from "../../shared/plan-runtime.ts"

// A prototype on Drop's canvas: three items side by side, which the picker moves with transforms as the reader pans.
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<section id="v-one" data-variant="One" data-width="320" data-height="240"><p style="margin:0;height:240px">one</p></section>
<section id="v-two" data-variant="Two" data-width="320" data-height="240"><p style="margin:0;height:240px">two</p></section>
<section id="v-three" data-variant="Three" data-width="320" data-height="240"><p style="margin:0;height:240px">three</p></section>
</body></html>`

const marker = {
  id: "c1",
  n: 1,
  kind: "area",
  selector: "#v-two",
  ox: 100,
  oy: 100,
  ow: 500,
  oh: 500,
  quote: null,
  label: "section",
  resolved: false,
  earlier: false,
  author: "Max",
  image: null,
  body: "About this.",
  replies: 0,
}

// In Drop's viewer (bar), the picker takes the bar's commands, such as Space held in Drop's window.
async function open(browser, { bar = false } = {}) {
  const runtime = injectRuntime(html, false, 0, true)
  const escaped = (bar ? withVariantBar(runtime) : runtime).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const context = await browser.newContext({ viewport: { width: 1200, height: 700 } })
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "drop.test") return route.abort()
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
  const frame = page.frames()[1]
  await frame.waitForFunction(() => document.documentElement.dataset.prototypeLayout === "canvas", null, {
    timeout: 5000,
  })
  // The first visit fits every item once fonts are in and two frames have passed: the pans start after that.
  await frame.evaluate(async () => {
    await document.fonts.ready
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame)
  })
  return { page, frame }
}

// Pans the canvas by a wheel and reports, two frames later and long before the gesture settles (160 ms), where the
// item and what Drop drew on it are. So nothing waits for a resize to catch up.
const panAndMeasure = (frame, dx) =>
  frame.evaluate(async (dx) => {
    const shadow = document.querySelector("drop-comments").shadowRoot
    const before = document.querySelector("#v-two").getBoundingClientRect().left
    document.body.dispatchEvent(
      new WheelEvent("wheel", { deltaX: dx, deltaY: 0, clientX: 600, clientY: 40, bubbles: true, cancelable: true }),
    )
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const item = document.querySelector("#v-two").getBoundingClientRect()
    const box = (el) => el && { left: el.getBoundingClientRect().left, top: el.getBoundingClientRect().top }
    return {
      moved: item.left - before,
      item: { left: item.left, top: item.top, width: item.width, height: item.height },
      area: box(shadow.querySelector('.marks [data-slot="comment-mark-area"]')),
      pin: box(shadow.querySelector('.marks [data-slot="comment-mark-pin"]')),
      draft: box(shadow.querySelector('.draft [data-slot="comment-mark-area"]')),
    }
  }, dx)

test("pins and areas on a canvas item move with it in the same frame as the pan", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser)
    await page.evaluate((marker) => send({ type: "markers", markers: [marker] }), marker)
    await frame.waitForFunction(() =>
      document.querySelector("drop-comments").shadowRoot.querySelector('.marks [data-slot="comment-mark-area"]'),
    )
    for (const dx of [120, -260]) {
      const at = await panAndMeasure(frame, dx)
      assert.ok(Math.abs(at.moved + dx) < 1, "the canvas panned")
      assert.ok(Math.abs(at.area.left - (at.item.left + 0.1 * at.item.width)) < 1.5, "the area stays on its item")
      assert.ok(Math.abs(at.area.top - (at.item.top + 0.1 * at.item.height)) < 1.5, "the area stays on its item")
    }
  } finally {
    await browser.close()
  }
}, 30_000)

test("an area drawn across two canvas items goes on the one it covers most, and stays on it while it's written", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser)
    await page.evaluate(() => send({ type: "tool", tool: "comment" }))
    await frame.waitForFunction(() => document.querySelector("drop-comments").shadowRoot.querySelector(".draw"))
    const one = await frame.locator("#v-one").boundingBox()
    const two = await frame.locator("#v-two").boundingBox()
    // From the right edge of the first item to well inside the second: most of it is on the second.
    await page.mouse.move(one.x + one.width - 30, two.y + 40)
    await page.mouse.down()
    await page.mouse.move(two.x + 200, two.y + 160, { steps: 6 })
    await page.mouse.up()
    const area = await page.waitForFunction(() => posts.find((m) => m.type === "area")).then((h) => h.jsonValue())
    assert.equal(area.selector, "#v-two")
    assert.equal(area.ox, 0, "cut to the item's left edge")
    assert.ok(area.ow > 500 && area.ox + area.ow <= 1000)
    // Drop floats the composer under the area, from where the frame says it is now.
    await page.waitForFunction(() => posts.some((m) => m.type === "draft-place" && !m.id))

    const at = await panAndMeasure(frame, 150)
    assert.ok(Math.abs(at.moved + 150) < 1, "the canvas panned")
    assert.ok(Math.abs(at.draft.left - at.item.left) < 1.5, "the drawn area stays on its item")
    assert.ok(Math.abs(at.draft.top - (at.item.top + (area.oy / 1000) * at.item.height)) < 1.5)
    const place = await page.evaluate(() => posts.findLast((m) => m.type === "draft-place" && !m.id).rect)
    assert.ok(Math.abs(place.left - at.item.left) < 1.5, "the composer's place moved with it")

    // Sent or dropped: Drop clears the area, and the canvas moves alone again.
    await page.evaluate(() => send({ type: "clear-area" }))
    const count = await page.evaluate(() => posts.filter((m) => m.type === "draft-place").length)
    const after = await panAndMeasure(frame, 80)
    assert.ok(Math.abs(after.moved + 80) < 1, "the canvas panned")
    assert.equal(after.draft, null)
    assert.equal(await page.evaluate(() => posts.filter((m) => m.type === "draft-place").length), count)
  } finally {
    await browser.close()
  }
}, 30_000)

test("Space held under the comment tool pans the canvas instead of drawing an area, until the drag ends", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, { bar: true })
    await page.evaluate(() => send({ type: "tool", tool: "comment" }))
    await frame.waitForFunction(() => document.querySelector("drop-comments").shadowRoot.querySelector(".draw"))
    const left = () => frame.evaluate(() => document.querySelector("#v-two").getBoundingClientRect().left)
    const two = await frame.locator("#v-two").boundingBox()
    const start = { x: two.x + 100, y: two.y + 100 }
    const cursor = () =>
      frame.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x, y)
          return getComputedStyle(el.shadowRoot?.elementFromPoint(x, y) ?? el).cursor
        },
        [start.x, start.y],
      )
    assert.equal(await cursor(), "crosshair")

    // Space from Drop's window, as the bar sends it, then a drag over an item: the canvas follows it.
    await page.evaluate(() => send({ type: "picker", do: "hold" }))
    await frame.waitForFunction(() => document.documentElement.dataset.prototypeHand === "")
    assert.equal(await cursor(), "grab")
    let before = await left()
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 40, start.y, { steps: 4 })
    // Letting go of Space mid-drag finishes the pan.
    await page.evaluate(() => send({ type: "picker", do: "release" }))
    await page.mouse.move(start.x + 90, start.y, { steps: 4 })
    await page.mouse.up()
    assert.equal(Math.round((await left()) - before), 90)
    await frame.waitForFunction(() => !("prototypeHand" in document.documentElement.dataset))
    assert.equal(await page.evaluate(() => posts.some((m) => m.type === "area")), false, "the pan drew no area")

    // Space pressed in the page does the same.
    await frame.evaluate(() => {
      document.activeElement?.blur()
      window.focus()
    })
    await page.keyboard.down(" ")
    before = await left()
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x - 60, start.y, { steps: 4 })
    await page.mouse.up()
    await page.keyboard.up(" ")
    assert.equal(Math.round((await left()) - before), -60)
    assert.equal(await page.evaluate(() => posts.some((m) => m.type === "area")), false)

    // Space let go: the comment tool takes the pointer again.
    assert.equal(await cursor(), "crosshair")
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 80, start.y + 60, { steps: 4 })
    await page.mouse.up()
    await page.waitForFunction(() => posts.some((m) => m.type === "area"))
  } finally {
    await browser.close()
  }
}, 30_000)
