import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

// A comment still in Drop's outbox (useViewerFrame sends `waiting`) draws at once as the reader's, with a clock in the
// corner where a pin's count goes, and says it waits or wasn't sent: on an area's pin, a margin card, and a Pin-style
// gutter pin. Once the server's copy comes, it draws as any other.
const css = (name) => readFile(new URL(`../../shared/${name}`, import.meta.url), "utf8")
const [typeset, shell, theme] = await Promise.all(["typeset.css", "document-shell.css", "theme.css"].map(css))
const FONTS =
  '@import url("https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap");'

const html = `<h1>Plan</h1>
<p>Drop keeps every comment in its own tables, so both products share one store and one set of numbers.</p>
<h2>What changes</h2>
<p>The comments move behind the new API. Drop keeps the numbering, so comment #12 stays #12.</p>`
const base = {
  n: 0,
  ox: 0,
  oy: 0,
  ow: 0,
  oh: 0,
  label: null,
  resolved: false,
  earlier: false,
  author: "Maxi Garcia",
  image: null,
  replies: 0,
}
const text = { ...base, id: "local-1", kind: "text", selector: "body", quote: "one set of numbers", label: "p" }
const area = { ...base, id: "local-2", kind: "area", selector: "h2", ox: 0, oy: 0, ow: 400, oh: 1000, quote: null }

async function open(browser, view, markers) {
  const document = planDocument("markdown", "", false, html).replace(FONTS, `${typeset}${shell}</style><style>${theme}`)
  const escaped = document.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "drop.test"
      ? route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style>
            <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escaped}"></iframe>
            <script>addEventListener("message", (e) => {
              if (!e.data?.__drop || e.data.type !== "ready") return;
              e.source.postMessage({ __drop: true, type: "view", pins: true, ...${JSON.stringify(view)} }, "*");
              e.source.postMessage({ __drop: true, type: "markers", markers: ${JSON.stringify(markers)} }, "*");
            });
            window.toFrame = (message) => document.querySelector("iframe").contentWindow.postMessage({ __drop: true, ...message }, "*");</script>`,
        })
      : route.abort(),
  )
  const page = await context.newPage()
  await page.goto("https://drop.test/")
  return { context, page, frame: page.frames()[1] }
}

const drawn = (frame) =>
  frame.evaluate(() => {
    const root = document.querySelector("drop-comments").shadowRoot
    return {
      pins: [...root.querySelectorAll('[data-slot="comment-mark-pin"][data-id]')].map((pin) => ({
        id: pin.dataset.id,
        delivery: pin.dataset.delivery ?? null,
        clock: Boolean(pin.querySelector(".wt svg")),
        count: pin.querySelector("b")?.textContent ?? null,
        title: pin.title || null,
        label: pin.getAttribute("aria-label"),
      })),
      cards: [...root.querySelectorAll(".rail .g[data-id] .cr-card small")].map((line) => [
        line.closest(".g").dataset.id,
        line.textContent,
        line.dataset.delivery ?? null,
      ]),
    }
  })

test("a waiting comment's pin and card show a clock and say they wait, then draw as sent", async () => {
  const browser = await chromium.launch()
  try {
    const { frame, page } = await open(browser, { style: "card" }, [
      { ...text, body: "One store, really?", waiting: "pending" },
      { ...area, body: "The heading wraps", waiting: "failed" },
    ])
    await frame.waitForFunction(
      () =>
        document.querySelector("drop-comments")?.shadowRoot.querySelectorAll('[data-slot="comment-mark-pin"][data-id]')
          .length === 1 && document.querySelector("drop-comments").shadowRoot.querySelector(".rail .cr-card"),
    )
    const waiting = await drawn(frame)
    assert.deepEqual(waiting.cards, [["local-1", "Waiting to send", "pending"]])
    assert.deepEqual(waiting.pins, [
      {
        id: "local-2",
        delivery: "failed",
        clock: true,
        count: null,
        title: "Maxi Garcia · Not sent",
        label: null,
      },
    ])

    // The server took both: the same comments, numbered, with no clock and no line.
    await page.evaluate(
      ({ text, area }) =>
        window.toFrame({
          type: "markers",
          markers: [
            { ...text, id: "c1", n: 1, body: "One store, really?", replies: 1 },
            { ...area, id: "c2", n: 2, body: "The heading wraps" },
          ],
        }),
      { text, area },
    )
    await frame.waitForFunction(
      () => document.querySelector("drop-comments").shadowRoot.querySelector('[data-id="c2"]') !== null,
    )
    const sent = await drawn(frame)
    assert.deepEqual(sent.cards, [["c1", "1 reply", null]])
    assert.deepEqual(
      sent.pins.map(({ id, delivery, clock, title }) => [id, delivery, clock, title]),
      [["c2", null, false, "Maxi Garcia · #2"]],
    )
  } finally {
    await browser.close()
  }
})

test("in the Pin style, a waiting comment's gutter pin has a clock where its count goes", async () => {
  const browser = await chromium.launch()
  try {
    const { frame } = await open(browser, { style: "pin", me: { name: "Maxi Garcia", image: null } }, [
      { ...text, body: "One store, really?", replies: 1, waiting: "pending" },
    ])
    await frame.waitForFunction(
      () => document.querySelector("drop-comments")?.shadowRoot.querySelectorAll(".gp[data-id]").length === 1,
    )
    const { pins } = await drawn(frame)
    assert.deepEqual(pins, [
      {
        id: "local-1",
        delivery: "pending",
        clock: true,
        count: null,
        title: null,
        label: "Comment by Maxi Garcia, waiting to send",
      },
    ])
  } finally {
    await browser.close()
  }
})
