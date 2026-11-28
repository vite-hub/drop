import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { previewSandbox } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"
import { TYPESET_CSS } from "../../shared/typeset.ts"
import { migrate } from "../cost/harness.mjs"

migrate()
const { renderMarkdownCached, renderMarkdownDocument } = await import("../../server/utils/markdown-document.ts")
const styles = (
  await Promise.all(
    ["typeset.css", "document-shell.css"].map((file) =>
      readFile(new URL(`../../shared/${file}`, import.meta.url), "utf8"),
    ),
  )
).join("\n")

const picture = (width, height) => `https://img.test/${width}x${height}.svg`
async function images(page, document) {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === "drop.test") return route.fulfill({ contentType: "text/html; charset=utf-8", body: document })
    const size = url.hostname === "img.test" && url.pathname.match(/^\/(\d+)x(\d+)\.svg$/)
    if (!size) return route.abort()
    const [, width, height] = size
    return route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#888"/></svg>`,
    })
  })
  await page.goto("https://drop.test/d/replies")
}
// A card of a whole conversation: wider than the column, and taller than the window.
const markdown = `# Replies

Some text above the cards, long enough to wrap onto a second line in the column at any of the widths this test opens.

![Card](${picture(1100, 2200)})

![Small](${picture(320, 200)})

![Wide](${picture(1600, 800)}){.wide}

![Sized wide](${picture(1600, 800)}){.wide width="1000"}

![Inline wide](${picture(1600, 800)}){.wide} in a sentence stays in the column.
`

async function measure(page, frame) {
  const sizes = await frame.evaluate(async () => {
    await Promise.all([...document.images].map((image) => image.decode()))
    const article = document.querySelector("article")
    const style = getComputedStyle(article)
    const column = article.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const width = (alt) => document.querySelector(`img[alt="${alt}"]`).getBoundingClientRect().width
    return {
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      column,
      card: width("Card"),
      small: [width("Small"), document.querySelector('img[alt="Small"]').getBoundingClientRect().height],
      wide: width("Wide"),
      sized: width("Sized wide"),
      inline: width("Inline wide"),
    }
  })
  await page.close()
  return sizes
}

async function viewer(browser, width) {
  const body = (await renderMarkdownCached("doc-column", async () => markdown)).html
  const html = planDocument("markdown", markdown, false, body, 0, "readable").replace(
    `<style>${TYPESET_CSS}`,
    () => `<style>${TYPESET_CSS}${styles}`,
  )
  const escaped = html.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await images(
    page,
    `<style>body{margin:0}</style><iframe sandbox="${previewSandbox("markdown")}" srcdoc="${escaped}" style="width:100%;height:900px;border:0;display:block"></iframe>
      <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data); });</script>`,
  )
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  return measure(page, page.frames()[1])
}

async function standalone(browser, width) {
  const document = await renderMarkdownDocument(async () => markdown, "/f/replies.md", "replies.md")
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  await images(page, document.replace("</head>", `<style>${styles}</style></head>`))
  return measure(page, page.mainFrame())
}

const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) <= 0.5, `${message}: ${actual}px, expected ${expected}px`)

test(
  "a doc's column is wider, an image wider than it fills it, a small one keeps its size, and {.wide} takes the room beside it",
  { timeout: 60_000 },
  async () => {
    const browser = await chromium.launch()
    try {
      // The viewer's readable column is 52rem with 1.5rem of padding each side; the /f/ page's is 52rem.
      for (const [open, desktop] of [
        [viewer, 49],
        [standalone, 52],
      ]) {
        const wide = await open(browser, 1440)
        assert.equal(wide.column, desktop * wide.rem, open.name)
        near(wide.card, wide.column, `${open.name}: the tall card fills the column`)
        assert.deepEqual(wide.small, [320, 200], `${open.name}: a small image keeps its size`)
        assert.ok(
          wide.wide > wide.column && wide.wide <= 72 * wide.rem,
          `${open.name}: {.wide} grows to ${wide.wide}px, up to 72rem`,
        )
        assert.equal(wide.sized, 1000, `${open.name}: {.wide} with a width grows to it`)
        near(wide.inline, wide.column, `${open.name}: {.wide} inside a sentence stays in the column`)

        const phone = await open(browser, 390)
        assert.ok(phone.column < 390 && phone.column > 300, `${open.name}: ${phone.column}px on a phone`)
        near(phone.card, phone.column, `${open.name}: the card fills the phone's column`)
        assert.ok(
          phone.wide >= phone.column - 0.5 && phone.wide <= 390,
          `${open.name}: {.wide} takes at most the phone's width, ${phone.wide}px`,
        )
        assert.deepEqual(phone.small, [320, 200])
      }
    } finally {
      await browser.close()
    }
  },
)
