import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { injectRuntime } from "../../shared/plan-runtime.ts"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"

// Two boxes 60px apart side by side: #a is 200 × 100 with a 10px padding, #b 120 × 50.
const BOXES = `<div id="a" style="position:absolute;left:40px;top:40px;width:200px;height:100px;padding:10px;box-sizing:border-box;background:rgb(37 99 235)"><i></i></div>
<div id="b" style="position:absolute;left:300px;top:60px;width:120px;height:50px;margin:0;background:rgb(238 238 238)">Two</div>`
// A site's own styles, which must not reach the tool's drawings.
const SITE_CSS = `<style>html{font-size:10px}body{margin:0;color:red;font:40px/3 serif;letter-spacing:4px}div,b,span{display:block!important}</style>`
const A = { x: 140, y: 90 }
const B = { x: 360, y: 85 }

// What the tool drew: its labels, and the card's rows.
const read = (fx) => ({
  tags: [...fx.querySelectorAll(".tag")].map((tag) => tag.textContent),
  title: fx.querySelector(".card b")?.textContent ?? null,
  rows: [...fx.querySelectorAll(".card div")].map((row) => [...row.children].map((cell) => cell.textContent)),
  outlines: fx.querySelectorAll(".hl").length,
  card: fx.querySelector(".card") && {
    width: fx.querySelector(".card").getBoundingClientRect().width,
    font: getComputedStyle(fx.querySelector(".card")).fontSize,
    display: getComputedStyle(fx.querySelector(".card")).display,
    row: getComputedStyle(fx.querySelector(".card div")).display,
  },
})

async function measure(page, readFx) {
  await page.mouse.move(A.x, A.y, { steps: 3 })
  await page.waitForTimeout(50)
  const hovered = await readFx()
  await page.mouse.down()
  await page.mouse.up()
  await page.mouse.move(B.x, B.y, { steps: 3 })
  await page.waitForTimeout(50)
  return { hovered, picked: await readFx() }
}

// The same reading in a drop's frame (plan-runtime) and on a site (review.js), from the one shared implementation.
const EXPECTED = {
  hovered: {
    tags: ["200 × 100"],
    title: "div#a",
    rows: [
      ["Size", "200 × 100"],
      ["Fill", "#2563eb"],
      ["Padding", "10"],
    ],
    outlines: 1,
  },
  picked: {
    tags: ["60"],
    title: "div#a",
    rows: [
      ["Size", "200 × 100"],
      ["Fill", "#2563eb"],
      ["Padding", "10"],
    ],
    outlines: 2,
  },
}
const shape = ({ card: _card, ...rest }) => rest

test(
  "Measure in a drop's frame: an element's size and box, and the distance from a picked one",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext({ viewport: { width: 900, height: 600 } })
      const doc = injectRuntime(`<!doctype html><html><head></head><body>${BOXES}</body></html>`, false, 0, true)
      await context.route("**/*", (route) => {
        if (new URL(route.request().url()).hostname !== "drop.test") return route.abort()
        return route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<style>body{margin:0}iframe{border:0;width:100vw;height:600px;display:block}</style>
          <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${doc.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"></iframe>
          <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data); });
          window.send = (message) => document.querySelector("iframe").contentWindow.postMessage({ __drop: true, ...message }, "*");</script>`,
        })
      })
      const page = await context.newPage()
      await page.goto("https://drop.test/")
      await page.waitForFunction(() => posts.some((m) => m.type === "ready"), null, { timeout: 5000 })
      const frame = page.frames()[1]
      await page.evaluate(() => send({ type: "tool", tool: "measure" }))
      await page.waitForFunction(() => posts.some((m) => m.type === "tool" && m.tool === "measure"), null, {
        timeout: 5000,
      })
      const result = await measure(page, () =>
        frame.evaluate(`(${read})(document.querySelector("drop-comments").shadowRoot.querySelector(".fx"))`),
      )
      assert.deepEqual({ hovered: shape(result.hovered), picked: shape(result.picked) }, EXPECTED)
      await context.close()
    } finally {
      await browser.close()
    }
  },
)

const SITE = "https://pr-12.preview.example.com"
const DROP = "https://drop.example.com"

test(
  "review.js offers Measure on a site, from the same code, with none of the site's styles",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch()
    try {
      const context = await browser.newContext({ viewport: { width: 900, height: 600 } })
      // The toolbar's shadow roots are closed; opened here so the test can read the drawings.
      await context.addInitScript(() => {
        const { value: attach } = Object.getOwnPropertyDescriptor(Element.prototype, "attachShadow")
        Element.prototype.attachShadow = function (init) {
          return Reflect.apply(attach, this, [this.id === "closed-editor" ? init : { ...init, mode: "open" }])
        }
      })
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url())
        if (url.origin === SITE)
          return route.fulfill({
            contentType: "text/html; charset=utf-8",
            body: `<!doctype html><html><head>${SITE_CSS}</head><body>${BOXES}<input id="q" style="position:absolute;left:40px;top:300px">
            <div id="closed-editor"></div>
            <section id="menu" popover="manual"><button>Do something</button></section>
            <script>window.clicks = 0; document.addEventListener("click", () => clicks++);
            window.editor = document.querySelector("#closed-editor").attachShadow({mode: "closed"});
            editor.innerHTML = "<input>";</script>
            <script src="${DROP}/review.js"></script>
            <script>window.siteOwnsS = true; addEventListener("keydown", (event) => {
              if (siteOwnsS && event.key === "s") event.preventDefault();
            });</script></body></html>`,
          })
        if (url.origin === DROP && url.pathname === "/review.js")
          return route.fulfill({ contentType: "text/javascript", body: REVIEW_SCRIPT })
        return route.abort()
      })
      const page = await context.newPage()
      await page.goto(SITE + "/")
      const button = page.locator("drop-review [data-act=measure]")
      await button.waitFor()
      assert.equal(await button.getAttribute("aria-keyshortcuts"), "S")
      const gaugeFx = () =>
        page.evaluate(
          `(${read})(document.querySelector("drop-review").shadowRoot.querySelector(".gauge").shadowRoot.querySelector(".fx"))`,
        )
      const pressed = () => button.getAttribute("aria-pressed")
      const shortcut = async () => {
        await page.keyboard.press("s")
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      }

      await shortcut()
      assert.equal(await pressed(), "false", "a later window listener can reserve S")
      await page.evaluate(() => {
        siteOwnsS = false
        editor.querySelector("input").focus()
      })
      await shortcut()
      assert.equal(await pressed(), "false")
      assert.equal(await page.evaluate(() => editor.querySelector("input").value), "s")
      // S in the site's own field is the field's.
      await page.locator("#q").click()
      await page.keyboard.type("s")
      assert.equal(await pressed(), "false")
      assert.equal(await page.locator("#q").inputValue(), "s")
      await page.locator("#q").blur()
      await page.evaluate(() => (clicks = 0))

      await page.locator("#menu").evaluate((menu) => menu.showPopover())
      await shortcut()
      assert.equal(await pressed(), "false", "Measure cannot intercept a native popover")
      await button.click()
      assert.equal(await pressed(), "false")
      assert.equal(await page.locator("#menu").evaluate((menu) => menu.matches(":popover-open")), true)
      await page.locator("#menu").evaluate((menu) => menu.hidePopover())
      await button.blur()

      await shortcut()
      assert.equal(await pressed(), "true")
      const result = await measure(page, gaugeFx)
      assert.deepEqual({ hovered: shape(result.hovered), picked: shape(result.picked) }, EXPECTED)
      // The card is Drop's size and type whatever the site's root font size, display rules and text styles.
      assert.deepEqual(result.picked.card, { width: 240, font: "11px", display: "block", row: "flex" })
      assert.equal(await page.evaluate(() => clicks), 0, "the site hears no click under Measure")

      await page.evaluate(() => {
        document.body.style.height = "200vh"
        document.body.insertAdjacentHTML(
          "beforeend",
          '<div id="c" style="position:absolute;left:340px;top:160px;width:120px;height:50px">Three</div>',
        )
      })
      await page.mouse.wheel(0, 100)
      const drawings = `(${read})(document.querySelector("drop-review").shadowRoot.querySelector(".gauge").shadowRoot.querySelector(".fx"))`
      await page.waitForFunction(`${drawings}.tags.includes("100")`)
      assert.equal((await gaugeFx()).title, "div#a", "scrolling keeps the original pick, but rechecks the hover")

      // Esc unpicks, then puts Measure down; the button turns it on again.
      await page.keyboard.press("Escape")
      await page.waitForTimeout(50)
      assert.equal((await gaugeFx()).outlines, 1)
      assert.equal((await gaugeFx()).title, "div#c")
      await page.keyboard.press("Escape")
      assert.equal(await pressed(), "false")
      assert.equal(await page.evaluate(() => document.elementFromPoint(360, 85).id), "c")
      await button.click()
      assert.equal(await pressed(), "true")
      await page.locator("#menu").evaluate((menu) => menu.showPopover())
      await page.waitForFunction(
        () =>
          document
            .querySelector("drop-review")
            .shadowRoot.querySelector("[data-act=measure]")
            .getAttribute("aria-pressed") === "false",
      )
      await context.close()
    } finally {
      await browser.close()
    }
  },
)
