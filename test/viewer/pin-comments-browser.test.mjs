import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

// The Pin comment style (view.style "pin"): text comments on a Markdown doc get an avatar pin in the gutter right of the
// column, level with the quote's last line, instead of the margin's cards.
const css = (name) => readFile(new URL(`../../shared/${name}`, import.meta.url), "utf8")
const [typeset, shell, theme] = await Promise.all(["typeset.css", "document-shell.css", "theme.css"].map(css))
const FONTS =
  '@import url("https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap");'

const html = `<h1>Plan</h1>
<p>Drop keeps every comment in its own tables, so both products share one store and one set of numbers.</p>
<h2>What changes</h2>
<p>The comments move behind the new API. Drop keeps the numbering, so comment #12 stays #12, and the endpoint returns the same shape.</p>
<h2>Rollout</h2>
<p>We copy every comment behind a flag, then compare both stores for a week.</p>`
const text = (id, quote, extra = {}) => ({
  id,
  n: Number(id.slice(1)),
  kind: "text",
  selector: "body",
  ox: 0,
  oy: 0,
  ow: 0,
  oh: 0,
  quote,
  label: "p",
  resolved: false,
  earlier: false,
  author: "Sara Lindqvist",
  image: null,
  body: `About ${quote}.`,
  replies: 0,
  ...extra,
})
const markers = [text("c1", "one set of numbers"), text("c2", "behind the new API", { replies: 2 })]
const view = { type: "view", pins: true, style: "pin", me: { name: "Maxi Garcia", image: null } }

async function open(browser, width) {
  const document = planDocument("markdown", "", false, html).replace(FONTS, `${typeset}${shell}</style><style>${theme}`)
  const escaped = document.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  await context.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "drop.test"
      ? route.fulfill({
          contentType: "text/html",
          body: `<style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style>
            <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escaped}"></iframe>
            <script>window.posts = []; addEventListener("message", (e) => {
              if (!e.data?.__drop) return;
              window.posts.push(e.data);
              if (e.data.type !== "ready") return;
              e.source.postMessage({ __drop: true, ...${JSON.stringify(view)} }, "*");
              e.source.postMessage({ __drop: true, type: "markers", markers: ${JSON.stringify(markers)} }, "*");
            });
            window.toFrame = (message) => document.querySelector("iframe").contentWindow.postMessage({ __drop: true, ...message }, "*");</script>`,
        })
      : route.abort(),
  )
  const page = await context.newPage()
  await page.goto("https://drop.test/")
  const frame = page.frames()[1]
  await frame.waitForFunction(
    () => document.querySelector("drop-comments")?.shadowRoot.querySelectorAll(".gp").length === 2,
  )
  await frame.evaluate(() => document.fonts.ready)
  return { context, page, frame }
}

const drawn = (frame) =>
  frame.evaluate(() => {
    const root = document.querySelector("drop-comments").shadowRoot
    const lastLine = (quote) => {
      const walker = document.createTreeWalker(document.querySelector("article"), NodeFilter.SHOW_TEXT)
      for (let node; (node = walker.nextNode());) {
        const at = node.data.indexOf(quote)
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + quote.length)
        const rects = range.getClientRects()
        return rects[rects.length - 1].toJSON()
      }
    }
    const article = document.querySelector("main > article")
    const pad = parseFloat(getComputedStyle(article).paddingRight)
    return {
      rail: document.documentElement.getAttribute("data-drop-rail"),
      tight: document.documentElement.getAttribute("data-drop-pins"),
      scroll: document.documentElement.scrollWidth - innerWidth,
      width: innerWidth,
      textRight: article.getBoundingClientRect().right - pad,
      cards: root.querySelectorAll(".rail .g").length,
      pins: [...root.querySelectorAll(".gp")].map((pin) => ({
        id: pin.dataset.id ?? "draft",
        label: pin.getAttribute("aria-label"),
        count: pin.querySelector("b")?.textContent ?? null,
        ...pin.getBoundingClientRect().toJSON(),
      })),
      lines: { c1: lastLine("one set of numbers"), c2: lastLine("behind the new API") },
      open: CSS.highlights.get("drop-open")?.size ?? 0,
    }
  })

test("pins sit in the gutter level with their quote's last line, and the eye hides them", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, 1440)
    const wide = await drawn(frame)
    assert.equal(wide.rail, null, "no margin of cards")
    assert.equal(wide.cards, 0)
    assert.equal(wide.scroll, 0)
    assert.equal(wide.open, 2, "both quotes stay marked")
    for (const pin of wide.pins) {
      const line = wide.lines[pin.id]
      assert.equal(pin.width, 28)
      assert.ok(pin.left >= wide.textRight + 8, `${pin.id} sits right of the text, not over it`)
      assert.ok(
        Math.abs(pin.top + pin.height / 2 - (line.top + line.height / 2)) <= 1,
        `${pin.id} is level with its line`,
      )
    }
    assert.deepEqual(
      wide.pins.map((pin) => [pin.id, pin.count]),
      [
        ["c1", null],
        ["c2", "3"],
      ],
    )
    assert.match(wide.pins[1].label, /3 comments/)

    // A pin opens its thread, as the old pins did.
    await frame.locator('drop-comments .gp[data-id="c2"]').click()
    await page.waitForFunction(() => window.posts.some((m) => m.type === "marker" && m.id === "c2"))
    // The thread Drop shows: its pin says so and reports where it is, so its bubble follows the page.
    await page.evaluate(() => window.toFrame({ type: "active", id: "c2" }))
    await page.waitForFunction(() => window.posts.some((m) => m.type === "draft-place" && m.id === "c2" && m.pin))
    assert.equal(
      await frame.evaluate(() =>
        document
          .querySelector("drop-comments")
          .shadowRoot.querySelector('.gp[data-id="c2"]')
          .getAttribute("aria-expanded"),
      ),
      "true",
    )
    // A click on the page away from the pins puts the open thread away.
    await frame.locator("h1").click()
    await page.waitForFunction(() => window.posts.some((m) => m.type === "page-click"))
    await page.evaluate(() => window.toFrame({ type: "active", id: null }))

    // The eye takes the pins and the quotes' marks away, and brings them back.
    await page.evaluate((view) => window.toFrame({ ...view, pins: false }), view)
    await frame.waitForFunction(() =>
      [...document.querySelector("drop-comments").shadowRoot.querySelectorAll(".gp")].every(
        (pin) => !pin.checkVisibility(),
      ),
    )
    assert.equal(await frame.evaluate(() => CSS.highlights.get("drop-open")?.size ?? 0), 0)
    await page.evaluate((view) => window.toFrame(view), view)
    await frame.waitForFunction(() => CSS.highlights.get("drop-open")?.size === 2)
  } finally {
    await browser.close()
  }
}, 30_000)

test("a mouse selection is reported, and the held draft gets the reader's pin where Drop floats the composer", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, 1440)
    const p = frame.locator("article p").last()
    const box = await p.boundingBox()
    await page.mouse.move(box.x + 4, box.y + 8)
    await page.mouse.down()
    await page.mouse.move(box.x + 200, box.y + 10, { steps: 6 })
    await page.mouse.up()
    await page.waitForFunction(() => window.posts.some((m) => m.type === "selection" && m.quote))
    await page.evaluate(() => window.toFrame({ type: "hold-selection" }))
    await page.waitForFunction(() => window.posts.some((m) => m.type === "draft-place" && m.pin && !m.id))
    // Measured once its pop-in is over: the place Drop hears is where it's laid out, unscaled.
    await frame.waitForTimeout(300)
    const held = await drawn(frame)
    const draft = held.pins.find((pin) => pin.id === "draft")
    assert.ok(draft, "the draft has a pin")
    assert.ok(draft.left >= held.textRight + 8)
    const place = await page.evaluate(() => window.posts.findLast((m) => m.type === "draft-place").rect)
    assert.equal(Math.round(place.left), Math.round(draft.left))

    // Sent: the draft's pin goes, and the comment's pin takes its place without popping in.
    await page.evaluate(() => window.toFrame({ type: "clear-selection" }))
    await page.evaluate(
      (markers) => window.toFrame({ type: "markers", markers }),
      [...markers, text("c3", "We copy every comment", { author: "Maxi Garcia" })],
    )
    await frame.waitForFunction(() =>
      document.querySelector("drop-comments").shadowRoot.querySelector('.gp[data-id="c3"]'),
    )
    const sent = await frame.evaluate(() => {
      const root = document.querySelector("drop-comments").shadowRoot
      return {
        draft: Boolean(root.querySelector(".gp[data-draft]")),
        popped: root.querySelector('.gp[data-id="c3"]').classList.contains("in"),
      }
    })
    assert.deepEqual(sent, { draft: false, popped: false })
  } finally {
    await browser.close()
  }
}, 30_000)

test("with comments hidden, the draft's pin and the comments Drop names in only show, and one that goes pops out", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, 1440)
    const pins = () =>
      frame.evaluate(() => {
        const root = document.querySelector("drop-comments").shadowRoot
        return {
          shown: [...root.querySelectorAll(".marks .gp")]
            .filter((pin) => pin.checkVisibility())
            .map((pin) => pin.dataset.id ?? "draft"),
          leaving: root.querySelectorAll(".leave > *").length,
          open: CSS.highlights.get("drop-open")?.size ?? 0,
        }
      })
    await page.evaluate((view) => window.toFrame({ ...view, pins: false }), view)
    await frame.waitForFunction(() => !document.querySelector("drop-comments").shadowRoot.querySelector(".marks .gp"))
    assert.deepEqual(await pins(), { shown: [], leaving: 0, open: 0 })

    // Writing a comment: its draft pin shows, and nothing else does.
    const p = frame.locator("article p").last()
    const box = await p.boundingBox()
    await page.mouse.move(box.x + 4, box.y + 8)
    await page.mouse.down()
    await page.mouse.move(box.x + 200, box.y + 10, { steps: 6 })
    await page.mouse.up()
    await page.waitForFunction(() => window.posts.some((m) => m.type === "selection" && m.quote))
    await page.evaluate(() => window.toFrame({ type: "hold-selection" }))
    await page.waitForFunction(() => window.posts.some((m) => m.type === "draft-place" && m.pin && !m.id))
    assert.deepEqual((await pins()).shown, ["draft"])

    // Sent: Drop names it in only, so its pin shows alone; the others stay hidden.
    await page.evaluate(() => window.toFrame({ type: "clear-selection" }))
    await page.evaluate(
      (markers) => window.toFrame({ type: "markers", markers }),
      [...markers, text("c3", "We copy every comment", { author: "Maxi Garcia" })],
    )
    await page.evaluate((view) => window.toFrame({ ...view, pins: false, only: ["c3"] }), view)
    await frame.waitForFunction(() =>
      document.querySelector("drop-comments").shadowRoot.querySelector('.gp[data-id="c3"]'),
    )
    assert.deepEqual(await pins(), { shown: ["c3"], leaving: 0, open: 1 })

    // Then Drop lets it go: it leaves with a pop-out, and comments are hidden again.
    await page.evaluate((view) => window.toFrame({ ...view, pins: false, only: [] }), view)
    const leaving = await pins()
    assert.deepEqual(leaving, { shown: [], leaving: 1, open: 0 })
    await frame.waitForFunction(() => !document.querySelector("drop-comments").shadowRoot.querySelector(".leave > *"))

    // The eye still shows every comment.
    await page.evaluate((view) => window.toFrame(view), view)
    await frame.waitForFunction(
      () => document.querySelector("drop-comments").shadowRoot.querySelectorAll(".marks .gp").length === 3,
    )
  } finally {
    await browser.close()
  }
}, 30_000)

test("on a phone the column makes room, so a pin never covers the text", async () => {
  const browser = await chromium.launch()
  try {
    const { frame } = await open(browser, 390)
    const narrow = await drawn(frame)
    assert.equal(narrow.tight, "tight")
    assert.equal(narrow.scroll, 0)
    for (const pin of narrow.pins) {
      assert.ok(pin.left >= narrow.textRight + 4, `${pin.id} clears the text`)
      assert.ok(pin.right <= narrow.width, `${pin.id} stays on screen`)
    }
  } finally {
    await browser.close()
  }
}, 30_000)
