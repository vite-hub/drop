import assert from "node:assert/strict"
import { chromium } from "playwright"
import { beforeEach, test } from "vite-plus/test"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"
import { embedDocument } from "../../shared/plan-runtime.ts"
import { migrate, reset } from "../cost/harness.mjs"

const { renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

migrate()
beforeEach(reset)

// A widget like the steps figure that started this: one HTML file whose script draws, and that stores a setting.
const WIDGET = `<!doctype html><html><head><title>Steps</title></head><body><p id="out">not run</p><script>
  localStorage.setItem("step", "2");
  document.getElementById("out").textContent = "ran on " + location.origin + ", step " + localStorage.getItem("step");
</script></body></html>`

test("a ::drop box asks the viewer for its drop and runs it in a sandbox of its own, or shows why it can't", async () => {
  const { html } = await renderMarkdownCached(
    "embed-browser.md",
    async () => "# Doc\n\n::drop{link=k7f2q9m4x8wd height=300}\n::\n\n::drop{link=a1b2c3d4e5f6}\n::\n",
  )
  const srcdoc = planDocument("markdown", "", true, html).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const answers = {
    k7f2q9m4x8wd: { html: embedDocument(WIDGET, true) },
    a1b2c3d4e5f6: { error: "This drop is private, expired, or deleted, so it can't show here." },
  }

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 900 } })
    await context.route("**/*", (route) =>
      new URL(route.request().url()).hostname === "drop.test"
        ? route.fulfill({
            contentType: "text/html",
            body: `<style>body{margin:0}iframe{border:0;width:100vw;height:880px;display:block}</style>
              <iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${srcdoc}"></iframe>
              <script>const answers = ${JSON.stringify(answers).replaceAll("<", "\\u003c")}; window.asked = [];
              addEventListener("message", (e) => {
                if (e.data?.__drop !== true || e.data.type !== "embeds") return;
                for (const link of e.data.links) {
                  asked.push(link);
                  e.source.postMessage({ __drop: true, type: "embed-data", link, ...answers[link] }, "*");
                }
              });</script>`,
          })
        : route.abort(),
    )
    const page = await context.newPage()
    await page.goto("https://drop.test/")
    const doc = page.frames()[1]
    await doc.waitForSelector(".drop-embed iframe", { timeout: 5000 })
    assert.deepEqual((await page.evaluate(() => asked)).sort(), ["a1b2c3d4e5f6", "k7f2q9m4x8wd"])

    const frame = await doc.$eval(".drop-embed iframe", (element) => ({
      sandbox: element.getAttribute("sandbox"),
      height: element.getBoundingClientRect().height,
    }))
    assert.deepEqual(frame, { sandbox: "allow-scripts", height: 300 })

    const widget = page.frames().find((candidate) => candidate.parentFrame() === doc)
    await widget.waitForFunction(() => document.getElementById("out").textContent !== "not run")
    // An opaque origin: the drop's script runs and keeps its storage, but has no origin to reach Drop from.
    assert.equal(await widget.textContent("#out"), "ran on null, step 2")
    assert.equal(await widget.evaluate(() => document.documentElement.classList.contains("dark")), true)

    assert.equal(
      await doc.textContent(".drop-embed .drop-embed-note"),
      "This drop is private, expired, or deleted, so it can't show here.",
    )
  } finally {
    await browser.close()
  }
}, 30_000)
