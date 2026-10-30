import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { injectRuntime } from "../../shared/plan-runtime.ts"

// A tooltip like the demand-outlier prototype's (drop z1ddehrxxznb): hover opens it, a click keeps it open, and it
// closes when the pointer leaves, when its button loses focus, and on any click outside it. It opens over a row smaller
// than itself, as the prototype's opens over the next alert.
const html = `<!doctype html><html><head><style>
  body { margin: 40px; font: 16px/1.5 sans-serif; }
  .tip { position: relative; display: inline-block; }
  .tip-content { display: none; position: absolute; left: 0; top: 32px; width: 260px; padding: 12px; background: #222; color: #fff; }
  .tip.is-open .tip-content { display: block; }
  /* The prototype's own: hidden but keeping its box. */
  .fade .fade-content { position: absolute; left: 0; top: 32px; width: 200px; padding: 8px; background: #222; color: #fff; visibility: hidden; opacity: 0; }
  .fade.is-open .fade-content { visibility: visible; opacity: 1; }
  dialog p { width: 300px; height: 80px; margin: 0; }
</style></head><body>
<section id="v-a" data-variant="A">
  <span class="tip" data-tip><button id="v-a-trigger" type="button" aria-describedby="v-a-tip">25.8× average demand line</button>
  <span class="tip-content" role="tooltip" id="v-a-tip"><b>Compared with</b> the average line for this product.</span></span>
  <p id="v-a-row" style="margin: 0; width: 220px; height: 40px">Example product B</p>
  <span class="fade" data-fade style="position: relative; display: inline-block; margin-top: 120px"><button id="v-a-fade-trigger" type="button" aria-describedby="v-a-fade">8.4× average demand line</button>
  <span class="fade-content" role="tooltip" id="v-a-fade"><b>Compared with</b> the average line.</span></span>
  <dialog id="v-a-dialog"><p>Resolve this alert for every planner?</p></dialog>
  <p id="v-a-text">Below the tooltip.</p>
</section>
<section id="v-b" data-variant="B" hidden><p id="v-b-text">The second variant.</p></section>
<script>
  window.pageClicks = 0;
  const tip = document.querySelector("[data-tip]"), trigger = tip.querySelector("button");
  const set = (open) => tip.classList.toggle("is-open", open);
  tip.addEventListener("pointerenter", () => set(true));
  tip.addEventListener("pointerleave", () => { if (!tip.classList.contains("is-pinned")) set(false); });
  trigger.addEventListener("blur", () => { tip.classList.remove("is-pinned"); set(false); });
  trigger.addEventListener("click", (e) => { e.stopPropagation(); tip.classList.add("is-pinned"); set(true); });
  document.addEventListener("click", (e) => { pageClicks++; if (!e.target.closest("[data-tip]")) { tip.classList.remove("is-pinned"); set(false); } });
  const fade = document.querySelector("[data-fade]");
  fade.addEventListener("pointerenter", () => fade.classList.add("is-open"));
  fade.addEventListener("pointerleave", () => fade.classList.remove("is-open"));
</script></body></html>`

// modern-screenshot, as the frame loads it from esm.sh: a plain grey viewport, so the test needs no network.
const SCREENSHOT_STUB = `export async function createContext(node, options) { return { ...options, drawImageCount: 0 } }
export async function domToBlob(context) {
  const canvas = new OffscreenCanvas(context.width, context.height), g = canvas.getContext("2d");
  g.fillStyle = "#888"; g.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: "image/png" });
}`

const marker = (id, selector, extra = {}) => ({
  id,
  n: Number(id.slice(1)),
  kind: "area",
  selector,
  ox: 0,
  oy: 0,
  ow: 1000,
  oh: 1000,
  quote: null,
  label: "span",
  resolved: false,
  earlier: false,
  author: "Max",
  image: null,
  body: "About this.",
  replies: 0,
  ...extra,
})

async function open(browser) {
  const escaped = injectRuntime(html, false, 0, true).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const context = await browser.newContext({ viewport: { width: 900, height: 700 } })
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === "esm.sh")
      return route.fulfill({
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: SCREENSHOT_STUB,
      })
    if (url.hostname !== "drop.test") return route.abort()
    return route.fulfill({
      contentType: "text/html",
      body: `<style>body{margin:0}iframe{border:0;width:100vw;height:600px;display:block}</style>
        <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escaped}"></iframe><textarea id="composer"></textarea>
        <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data); });
        window.send = (message) => document.querySelector("iframe").contentWindow.postMessage({ __drop: true, ...message }, "*");</script>`,
    })
  })
  const page = await context.newPage()
  await page.goto("https://drop.test/")
  page.on("console", (m) => process.env.DEBUG && console.log("frame:", m.text()))
  page.on("pageerror", (e) => process.env.DEBUG && console.log("error:", e.message))
  await page.waitForFunction(() => posts.some((m) => m.type === "ready"), null, { timeout: 5000 })
  return { context, page, frame: page.frames()[1] }
}

const isOpen = (frame, selector = "[data-tip]") =>
  frame.evaluate((selector) => document.querySelector(selector).classList.contains("is-open"), selector)
async function drag(page, box, dx = 110, dy = 10) {
  await page.mouse.move(box.left + 10, box.top + 6)
  await page.mouse.down()
  await page.mouse.move(box.left + 10 + dx, box.top + 6 + dy, { steps: 5 })
  await page.mouse.up()
}
const pins = (frame) =>
  frame.evaluate(() =>
    [...document.querySelector("drop-comments").shadowRoot.querySelectorAll(".m")].map((pin) => ({
      id: pin.dataset.id,
      away: pin.classList.contains("away"),
      left: parseFloat(pin.style.left),
      top: parseFloat(pin.style.top),
    })),
  )
async function setTool(page, tool) {
  await page.evaluate((tool) => send({ type: "tool", tool }), tool)
  await page.waitForFunction((tool) => posts.some((m) => m.type === "tool" && m.tool === tool), tool, { timeout: 5000 })
}

test("under the Comment tool a pinned tooltip stays open through focus leaving, the drawn box, and its click", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser)
    await frame.click("#v-a-trigger")
    assert.equal(await isOpen(frame), true)

    await setTool(page, "comment")
    // Drop's composer takes focus: the trigger's blur would close the tooltip.
    await page.focus("#composer")
    assert.equal(await isOpen(frame), true)

    const box = await frame.evaluate(() => document.getElementById("v-a-tip").getBoundingClientRect().toJSON())
    const clicksBefore = await frame.evaluate(() => pageClicks)
    await page.mouse.move(box.left + 10, box.top + 6)
    await page.mouse.down()
    await page.mouse.move(box.left + 120, box.top + 16, { steps: 5 })
    await page.mouse.up()
    const area = await page
      .waitForFunction(() => posts.find((m) => m.type === "area"), null, { timeout: 5000 })
      .then((h) => h.jsonValue())
    assert.match(area.selector, /#v-a-tip/)
    assert.equal(typeof area.shot, "number")
    // Neither the pointer leaving for the layer nor the click that ends the box reached the page.
    assert.equal(await isOpen(frame), true)
    assert.equal(await frame.evaluate(() => pageClicks), clicksBefore)

    const shot = await page
      .waitForFunction(
        (n) => {
          const m = posts.find((m) => m.type === "area-shot" && m.shot === n)
          return m && { type: m.image.type, size: m.image.size, blob: m.image instanceof Blob }
        },
        area.shot,
        { timeout: 5000 },
      )
      .then((h) => h.jsonValue())
    assert.equal(shot.blob, true)
    assert.match(shot.type, /^image\/(webp|png)$/)
    assert.ok(shot.size > 0)

    // Back under Browse the page has its events again: a click outside closes the tooltip.
    await setTool(page, "browse")
    await frame.click("#v-a-text")
    assert.equal(await isOpen(frame), false)
  } finally {
    await browser.close()
  }
}, 30_000)

test("a comment on a closed tooltip pins to its trigger, and one in a variant that isn't on draws nothing", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser)
    await page.evaluate(
      (markers) => send({ type: "markers", markers }),
      [marker("c1", "#v-a-tip > b"), marker("c2", "#v-b-text"), marker("c3", "#v-a-fade > b")],
    )
    await frame.waitForFunction(() => document.querySelector("drop-comments").shadowRoot.querySelector(".m"), null, {
      polling: 100,
      timeout: 5000,
    })
    const trigger = await frame.evaluate(() => document.getElementById("v-a-trigger").getBoundingClientRect().toJSON())
    const fadeTrigger = await frame.evaluate(() =>
      document.getElementById("v-a-fade-trigger").getBoundingClientRect().toJSON(),
    )
    const closed = await pins(frame)
    assert.deepEqual(
      closed.map((pin) => [pin.id, pin.away]),
      [
        ["c1", true],
        ["c3", true],
      ],
    )
    assert.ok(Math.abs(closed[0].left - trigger.right) < 1 && Math.abs(closed[0].top - trigger.top) < 1)
    // A tooltip hidden with visibility keeps its box, but its comment still waits on its trigger.
    assert.ok(Math.abs(closed[1].left - fadeTrigger.right) < 1 && Math.abs(closed[1].top - fadeTrigger.top) < 1)

    // Opened, the tooltip shows and its comment moves back onto it.
    await frame.hover("#v-a-trigger", { timeout: 5000 })
    await frame.waitForFunction(
      () =>
        [...document.querySelector("drop-comments").shadowRoot.querySelectorAll(".m")].some(
          (pin) => !pin.classList.contains("away"),
        ),
      null,
      { polling: 100, timeout: 5000 },
    )
    const shown = await pins(frame)
    const tip = await frame.evaluate(() => document.querySelector("#v-a-tip > b").getBoundingClientRect().toJSON())
    assert.deepEqual(
      shown.map((pin) => [pin.id, pin.away]),
      [
        ["c1", false],
        ["c3", true],
      ],
    )
    assert.ok(Math.abs(shown[0].left - tip.left) < 1 && Math.abs(shown[0].top - tip.top) < 1)

    // The fading one shows again by a class, with no change in size.
    await frame.hover("#v-a-fade-trigger")
    await frame.waitForFunction(
      () =>
        !document
          .querySelector("drop-comments")
          .shadowRoot.querySelector('.m[data-id="c3"]')
          .classList.contains("away"),
      null,
      { polling: 100, timeout: 5000 },
    )
  } finally {
    await browser.close()
  }
}, 30_000)

test("a tooltip opened by hover alone closes once the tool is put down away from it", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser)
    await frame.hover("#v-a-trigger")
    assert.equal(await isOpen(frame), true)
    await setTool(page, "comment")
    await page.mouse.move(800, 500, { steps: 5 })
    assert.equal(await isOpen(frame), true)
    await setTool(page, "browse")
    assert.equal(await isOpen(frame), false)
  } finally {
    await browser.close()
  }
}, 30_000)

test("under the Comment tool a box drawn in a modal dialog comments on the dialog", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser)
    await frame.evaluate(() => document.getElementById("v-a-dialog").showModal())
    await setTool(page, "comment")
    const box = await frame.evaluate(() => document.querySelector("#v-a-dialog p").getBoundingClientRect().toJSON())
    await drag(page, box)
    const area = await page
      .waitForFunction(() => posts.find((m) => m.type === "area"), null, { timeout: 5000 })
      .then((h) => h.jsonValue())
    assert.match(area.selector, /#v-a-dialog/)
    assert.equal(typeof area.shot, "number")
    assert.equal(await frame.evaluate(() => getSelection().isCollapsed), true)
  } finally {
    await browser.close()
  }
}, 30_000)
