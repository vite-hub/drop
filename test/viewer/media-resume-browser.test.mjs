import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { previewSandbox } from "../../app/utils/feedback.ts"
import { parseFrameMessage } from "../../shared/frame-messages.ts"
import { planDocument } from "../../shared/documents.ts"
import { injectRuntime } from "../../shared/plan-runtime.ts"
import { buildProjectDocument } from "../../shared/project-bundle.ts"

// A 20-second clip.
const CLIP = await readFile(new URL("fixtures/clip.webm", import.meta.url))
const SOURCE = "https://drop.test/clip.webm"
const REPLACEMENT = "https://drop.test/replacement.webm"

async function open(browser, source = SOURCE, { app = false } = {}) {
  const html = planDocument(
    "markdown",
    "# Launch film",
    false,
    `<h1>Launch film</h1><video src="${source}" controls preload="metadata"></video>`,
  )
  const escaped = html.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const page = await browser.newPage()
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== "drop.test") return route.abort()
    // With byte ranges, as a real server answers: without them Chromium can't seek the clip.
    if (url.href === SOURCE || url.href === REPLACEMENT) {
      const [, from = "0", to = String(CLIP.length - 1)] =
        /bytes=(\d*)-(\d*)/.exec(route.request().headers().range ?? "") ?? []
      const end = Math.min(Number(to || CLIP.length - 1), CLIP.length - 1)
      return route.fulfill({
        status: 206,
        contentType: "video/webm",
        headers: { "accept-ranges": "bytes", "content-range": `bytes ${from}-${end}/${CLIP.length}` },
        body: CLIP.subarray(Number(from), end + 1),
      })
    }
    if (app && url.pathname === "/home") {
      const files = {
        "index.html": `<!doctype html><html><head></head><body><video src="${source}" preload="metadata"></video></body></html>`,
      }
      return route.fulfill({
        contentType: "text/html",
        body: injectRuntime(buildProjectDocument(files, "index.html"), false, 0, true),
      })
    }
    return route.fulfill({
      contentType: "text/html",
      body: `${app ? '<iframe src="/home"></iframe>' : `<iframe sandbox="${previewSandbox("markdown")}" srcdoc="${escaped}"></iframe>`}
        <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data); });
          window.tell = (message) => frames[0].postMessage({ __drop: true, ...message }, "*");</script>`,
    })
  })
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  return { page, frame: page.frames()[1] }
}

const videoTime = (frame) =>
  frame
    .waitForFunction(() => document.querySelector("video").readyState >= 1)
    .then(() => frame.evaluate(() => document.querySelector("video").currentTime))

test("a video in a doc reports where the reader stopped it, and starts there next time", async () => {
  const browser = await chromium.launch()
  try {
    const first = await open(browser)
    await first.page.evaluate(() => window.tell({ type: "media-times", times: {} }))
    await videoTime(first.frame)
    await first.frame.evaluate(() => (document.querySelector("video").currentTime = 12))
    await first.page.waitForFunction(() => window.posts.some((m) => m.type === "media-time" && m.at > 11))
    const spot = await first.page.evaluate(() => window.posts.find((m) => m.type === "media-time" && m.at > 11))
    assert.deepEqual(parseFrameMessage(spot), { type: "media-time", index: 0, source: SOURCE, at: 12, duration: 20 })
    await first.page.close()

    const again = await open(browser)
    await again.page.evaluate((spot) => window.tell({ type: "media-times", times: { 0: spot } }), spot)
    await again.frame.waitForFunction(() => document.querySelector("video").currentTime > 11)
    assert.equal(await videoTime(again.frame), 12)
    await again.page.close()

    // A spot saved for a video of another length belongs to another video.
    for (const [source, duration] of [
      [SOURCE, 95],
      [REPLACEMENT, 20],
    ]) {
      const other = await open(browser, source)
      await videoTime(other.frame)
      await other.page.evaluate((spot) => window.tell({ type: "media-times", times: { 0: spot } }), {
        ...spot,
        duration,
      })
      await other.page.waitForTimeout(300)
      assert.equal(await videoTime(other.frame), 0)
      await other.page.close()
    }
  } finally {
    await browser.close()
  }
}, 30_000)

test("an app restores a distinct destination clip without reloading the frame", async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, SOURCE, { app: true })
    assert.equal(await videoTime(frame), 0)
    await frame.evaluate((source) => {
      window.sameDocument = true
      history.pushState({}, "", "/training")
      const video = document.createElement("video")
      video.preload = "metadata"
      video.src = source
      document.querySelector("video").replaceWith(video)
    }, REPLACEMENT)
    await page.waitForFunction(() =>
      window.posts.some((message) => message.type === "location" && message.path === "/training"),
    )
    assert.equal(await videoTime(frame), 0)
    await page.evaluate((source) => {
      window.tell({ type: "media-times", path: "/home", times: { 0: { source, at: 7, duration: 20 } } })
      window.tell({ type: "media-times", path: "/training", times: { 0: { source, at: 12, duration: 20 } } })
    }, REPLACEMENT)
    await frame.waitForFunction(() => document.querySelector("video").currentTime === 12)
    assert.equal(await frame.evaluate(() => window.sameDocument), true)
  } finally {
    await browser.close()
  }
}, 30_000)
