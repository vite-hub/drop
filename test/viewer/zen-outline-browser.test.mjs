import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { previewSandbox } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

const { renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

// Zen mode (the review pill's +, or Z) hides a Markdown doc's outline and gives its column back to wide blocks.
const filler = Array.from({ length: 30 }, (_, i) => `Line ${i} of the plan.`).join("\n\n")
const sections = `## Setup\n\n${filler}\n\n### Keys\n\n${filler}\n\n## Walkthrough\n\n${filler}\n`
const plain = (await renderMarkdownCached("zen-plain", async () => `# Plan\n\n${sections}`)).html
// A compare spreads past the text into the room beside it, so the outline keeps a column of its own there.
const shot = (color) =>
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="${color}"/></svg>`,
  )
const compare = `::compare\n:::screenshot{src="${shot("#ed2020")}" alt="Before" title="Before"}\n:::\n:::screenshot{src="${shot("#2020ed")}" alt="After" title="After"}\n:::\n::`
const wide = (await renderMarkdownCached("zen-compare", async () => `# Plan\n\n${compare}\n\n${sections}`)).html

async function open(browser, body, zen = false) {
  const html = planDocument("markdown", "# Plan", false, body, 0, "readable", zen)
  const escaped = html.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "drop.test"
      ? route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<style>body{margin:0}</style><iframe sandbox="${previewSandbox("markdown")}" srcdoc="${escaped}" style="width:1400px;height:800px;border:0;display:block"></iframe>
            <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data); });
              window.tell = (message) => frames[0].postMessage({ __drop: true, ...message }, "*");</script>`,
        })
      : route.abort(),
  )
  await page.goto("https://drop.test/d/plan")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  return { page, frame: page.frames()[1] }
}

const outline = (frame) => frame.locator(".cto-rail")
const railWidth = (frame) =>
  frame.locator("html").evaluate((root) => parseFloat(getComputedStyle(root).getPropertyValue("--comark-rail-width")))
async function zen(page, frame, on) {
  await page.evaluate((value) => window.tell({ type: "zen", on: value }), on)
  await frame.waitForFunction((value) => document.documentElement.hasAttribute("data-drop-zen") === value, on)
}

test("zen hides a doc's outline, and turning it off brings the outline back", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, plain)
    await outline(frame).waitFor({ state: "visible" })
    await zen(page, frame, true)
    assert.equal(await outline(frame).isVisible(), false)
    await zen(page, frame, false)
    await outline(frame).waitFor({ state: "visible" })
  } finally {
    await browser.close()
  }
})

test("zen gives back the column comark-outline reserves beside wide blocks", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, plain)
    await outline(frame).waitFor({ state: "visible" })
    // Simulate comark-outline reserving its own column independent of the viewport's wide-block fit.
    await frame.locator("html").evaluate((root) => root.setAttribute("data-comark-rail", ""))
    const before = await railWidth(frame)
    assert.ok(before > 0, `the outline reserved ${before}px`)
    await zen(page, frame, true)
    assert.equal(await railWidth(frame), 0)
    await zen(page, frame, false)
    assert.equal(await railWidth(frame), before)
  } finally {
    await browser.close()
  }
})

test("a doc built in zen opens without its outline, so it never flashes in", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch()
  try {
    const { frame } = await open(browser, wide, true)
    assert.equal(await outline(frame).count(), 1)
    assert.equal(await outline(frame).isVisible(), false)
    assert.equal(await railWidth(frame), 0)
  } finally {
    await browser.close()
  }
})
