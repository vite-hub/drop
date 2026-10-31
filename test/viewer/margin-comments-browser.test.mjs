import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

// Vitest reads CSS `?raw` imports as empty strings, so the frame gets the real stylesheets the way the app builds them.
const css = (name) => readFile(new URL(`../../shared/${name}`, import.meta.url), "utf8")
const [typeset, shell, theme] = await Promise.all(["typeset.css", "document-shell.css", "theme.css"].map(css))
const FONTS =
  '@import url("https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap");'

const html = `<h1>Plan</h1>
<p>Drop keeps every comment in its own tables, so both products share one store and one set of numbers.</p>
<h2>What changes</h2>
<p>The comments move behind the new API. Drop keeps the numbering, so comment #12 stays #12, and the endpoint returns the same shape. Resolved threads move too, but nothing shows them.</p>
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
const markers = [
  text("c1", "one set of numbers"),
  // The dense paragraph: four comments whose cards stack down from their lines.
  text("c2", "behind the new API", { replies: 2 }),
  text("c3", "comment #12 stays #12"),
  text("c4", "the same shape"),
  text("c5", "nothing shows them"),
  text("c6", "behind a flag", { resolved: true }),
  text("c7", "compare both stores", { earlier: true }),
  { ...text("c8", ""), kind: "area", selector: "h1", quote: null, ow: 1000, oh: 1000 },
]

async function open(browser, width) {
  const document = planDocument("markdown", "", false, html).replace(
    `<style>${FONTS}`,
    `<style>${typeset}${shell}</style><style>${theme}`,
  )
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
              if (e.data.type === "ready") e.source.postMessage({ __drop: true, type: "markers", markers: ${JSON.stringify(markers)} }, "*");
            });</script>`,
        })
      : route.abort(),
  )
  const page = await context.newPage()
  await page.goto("https://drop.test/")
  const frame = page.frames()[1]
  await frame.waitForFunction(() => document.querySelector("drop-comments")?.shadowRoot.querySelector(".m"))
  await frame.evaluate(() => document.fonts.ready)
  return { context, page, frame }
}

/** What the comment layer drew: the margin's cards and bubbles, the pins, and the text's place. */
const drawn = (frame) =>
  frame.evaluate(() => {
    const root = document.querySelector("drop-comments").shadowRoot
    const box = (el) => el.getBoundingClientRect()
    return {
      rail: document.documentElement.getAttribute("data-drop-rail"),
      scroll: document.documentElement.scrollWidth - innerWidth,
      width: innerWidth,
      text: box(document.querySelector("main > article > p")).right,
      cards: [...root.querySelectorAll(".rail .g")].map((group) => ({
        id: group.dataset.id,
        ...box(group.querySelector(".cr-card")).toJSON(),
        display: getComputedStyle(group.querySelector(".cr-card")).display,
      })),
      pins: [...root.querySelectorAll(".m")].map((pin) => pin.dataset.id),
      // Each bubble in the page's own text: its box, its count, and the box of the character after it.
      bubbles: Object.fromEntries(
        [...document.querySelectorAll("drop-bubble")].map((bubble) => {
          const next = bubble.nextSibling
          const after = document.createRange()
          if (next?.nodeType === 3 && next.data.length) {
            after.setStart(next, 0)
            after.setEnd(next, 1)
          }
          return [
            bubble.dataset.id,
            {
              ...box(bubble).toJSON(),
              count: getComputedStyle(bubble.querySelector("b") ?? bubble, "::before").content,
              after: next?.nodeType === 3 ? after.getBoundingClientRect().toJSON() : null,
            },
          ]
        }),
      ),
      outlines: root.querySelectorAll(".marks > .a.t").length,
      margin: CSS.highlights.get("drop-margin")?.size ?? 0,
    }
  })

test("open text comments on a wide doc sit beside their text as bubbles and margin cards", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, 1440)
    // The doc as the frame parsed it, before any comment drew.
    const original = await frame.evaluate((html) => {
      const parsed = document.createElement("template")
      parsed.innerHTML = html
      return parsed.innerHTML
    }, html)
    const wide = await drawn(frame)
    assert.equal(wide.rail, "open")
    assert.equal(wide.scroll, 0)
    assert.deepEqual(
      wide.cards.map((card) => card.id),
      ["c1", "c2", "c3", "c4", "c5"],
    )
    // Resolved comments, comments from an earlier version, and areas keep their pins.
    assert.deepEqual(wide.pins.toSorted(), ["c6", "c7", "c8"])
    assert.match(wide.bubbles.c2.count, /3"$/)
    // The quotes in the margin take the package's anchor look, so only the pinned comments keep their outlines.
    assert.equal(wide.margin, 5)
    assert.equal(wide.outlines, 2)
    for (const [index, card] of wide.cards.entries()) {
      const bubble = wide.bubbles[card.id]
      // The bubble takes its own room in the line: the text after it starts where it ends.
      if (bubble.after && bubble.after.top < bubble.bottom) assert.ok(bubble.after.left >= bubble.right - 0.5, card.id)
      assert.equal(card.display, "block")
      assert.ok(card.left > wide.text, "the card sits right of the text")
      assert.ok(card.right <= wide.width, "the card stays on screen")
      // Level with its line, or below the card before it.
      assert.ok(card.top >= bubble.top - 12)
      if (index) assert.ok(card.top >= wide.cards[index - 1].bottom + 7)
    }

    // Hiding the comments with the toolbar's eye takes the bubbles out and the margin away, so the doc is as it was and
    // centered again; showing them again finds every quote and lays the cards out as before.
    const view = (pins) =>
      page.evaluate(
        (pins) => document.querySelector("iframe").contentWindow.postMessage({ __drop: true, type: "view", pins }, "*"),
        pins,
      )
    await view(false)
    await frame.waitForFunction(() => !document.querySelector("drop-bubble"))
    assert.equal(await frame.evaluate(() => document.querySelector("article").innerHTML), original)
    assert.equal(await frame.evaluate(() => document.documentElement.getAttribute("data-drop-rail")), null)
    await view(true)
    await frame.waitForFunction(() => document.querySelectorAll("drop-bubble").length === 5)
    assert.deepEqual(
      (await drawn(frame)).cards.map((card) => card.top),
      wide.cards.map((card) => card.top),
    )

    // Hovering a card marks its text and its bubble; clicking it opens its thread, as a pin does.
    const card = frame.locator("drop-comments .rail .cr-card").nth(2)
    await card.hover()
    const hovered = await frame.evaluate(() => ({
      checked: [...document.querySelector("drop-comments").shadowRoot.querySelectorAll(".cr-tg")].map((t) => t.checked),
      bubble: document.querySelector('drop-bubble[data-id="c3"]').hasAttribute("data-on"),
      active: CSS.highlights.get("drop-active").size,
    }))
    assert.deepEqual(hovered, { checked: [false, false, true, false, false], bubble: true, active: 1 })
    await card.click()
    await page.waitForFunction(() => window.posts.some((m) => m.type === "marker" && m.id === "c3"))

    // The thread Drop shows keeps its card raised once the pointer leaves.
    await page.mouse.move(5, 5)
    await page.evaluate(() =>
      document.querySelector("iframe").contentWindow.postMessage({ __drop: true, type: "active", id: "c4" }, "*"),
    )
    await frame.waitForFunction(
      () => document.querySelector("drop-comments").shadowRoot.querySelectorAll(".cr-tg")[3].checked,
    )
  } finally {
    await browser.close()
  }
}, 30_000)

test("on a narrow doc every comment keeps its pin, with no sideways scroll", async () => {
  const browser = await chromium.launch()
  try {
    const { frame } = await open(browser, 390)
    const narrow = await drawn(frame)
    assert.equal(narrow.rail, "reserved")
    assert.equal(narrow.scroll, 0)
    assert.deepEqual(narrow.cards, [])
    assert.equal(narrow.pins.length, 8)
  } finally {
    await browser.close()
  }
}, 30_000)

test("leaving the frame clears quote hover while keeping the open thread raised", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, 1440)
    // Leave room in the parent for the pointer to exit the iframe without crossing other text inside it.
    await page.locator("iframe").evaluate((el) => {
      el.style.height = "850px"
    })
    const quote = await frame.evaluate(() => {
      const node = document.querySelector("p").firstChild
      const range = document.createRange()
      const start = node.data.indexOf("one set of numbers")
      range.setStart(node, start)
      range.setEnd(node, start + "one set of numbers".length)
      const rect = range.getClientRects()[0]
      return { x: rect.left + 2, y: (rect.top + rect.bottom) / 2 }
    })
    const state = () =>
      frame.evaluate(() => ({
        checked: [...document.querySelector("drop-comments").shadowRoot.querySelectorAll(".cr-tg")].map(
          (t) => t.checked,
        ),
        bubbles: [...document.querySelectorAll("drop-bubble[data-on]")].map((b) => b.dataset.id),
        active: CSS.highlights.get("drop-active").size,
      }))
    const hover = async () => {
      await page.mouse.move(quote.x, quote.y)
      await frame.waitForFunction(() => document.querySelector('drop-bubble[data-id="c1"]').hasAttribute("data-on"))
    }
    await hover()
    await page.mouse.move(10, 880)
    await frame.evaluate(() => new Promise(requestAnimationFrame))
    assert.deepEqual(await state(), { checked: [false, false, false, false, false], bubbles: [], active: 0 })

    await page.evaluate(() =>
      document.querySelector("iframe").contentWindow.postMessage({ __drop: true, type: "active", id: "c4" }, "*"),
    )
    await frame.waitForFunction(() => document.querySelector('drop-bubble[data-id="c4"]').hasAttribute("data-on"))
    await hover()
    await page.mouse.move(10, 880)
    await frame.evaluate(() => new Promise(requestAnimationFrame))
    assert.deepEqual(await state(), { checked: [false, false, false, true, false], bubbles: ["c4"], active: 1 })

    // A queued quote hit must not restore hover after the document loses the pointer or the window loses focus.
    for (const event of ["mouseleave", "blur"]) {
      await frame.evaluate(
        ({ quote, event }) => {
          document.dispatchEvent(new MouseEvent("mousemove", { clientX: quote.x, clientY: quote.y }))
          const target = event === "blur" ? window : document
          target.dispatchEvent(new Event(event))
          return new Promise(requestAnimationFrame)
        },
        { quote, event },
      )
      assert.deepEqual(await state(), { checked: [false, false, false, true, false], bubbles: ["c4"], active: 1 })
    }
  } finally {
    await browser.close()
  }
}, 30_000)
