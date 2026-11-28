import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test, vi } from "vite-plus/test"
import { previewSandbox } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

const { renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

const source = `# Lunch\n\n::poll{#lunch note}\nWhere do we eat on Friday?\n\n- [ ] Pizza\n- [ ] Tacos\n::\n`

async function open(browser) {
  const { html } = await renderMarkdownCached("poll-note.md", async () => source)
  vi.stubGlobal("location", { origin: "https://drop.test" })
  const escaped = planDocument("markdown", source, false, html).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  vi.unstubAllGlobals()
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== "drop.test" || url.pathname !== "/") return route.abort()
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<style>body{margin:0}iframe{display:block;width:100vw;height:100vh;border:0}</style>
        <iframe sandbox="${previewSandbox("markdown")}" srcdoc="${escaped}"></iframe>
        <script>window.quiz = []; addEventListener("message", (e) => { if (String(e.data?.type).startsWith("comark-quiz:")) window.quiz.push(e.data) });</script>`,
    })
  })
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => window.quiz.some((m) => m.type === "comark-quiz:ready"))
  return page
}

// What the viewer posts from the doc's state: the reader's own vote and note, and the counts. Option keys are hashes of their text.
const state = ({ pizza, tacos }, note) => ({
  type: "comark-quiz:state",
  detail: {
    answers: { lunch: { choice: [tacos], correct: null, ...(note === undefined ? {} : { note }) } },
    results: { lunch: { counts: { [tacos]: 3, [pizza]: 1 }, total: 4 } },
  },
})

test(
  "a poll's note comes back from Drop's state, and an edited note goes up with the vote",
  { timeout: 30000 },
  async () => {
    const browser = await chromium.launch()
    try {
      const page = await open(browser)
      const frame = page.frames()[1]
      const ready = await page.evaluate(() => window.quiz.find((m) => m.type === "comark-quiz:ready").detail.ids)
      assert.deepEqual(ready, ["lunch"])

      const keys = await frame.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll("[data-key]")].map((option) => [
            option.textContent.trim().toLowerCase(),
            option.dataset.key,
          ]),
        ),
      )
      const post = (message) =>
        page.evaluate((message) => document.querySelector("iframe").contentWindow.postMessage(message, "*"), message)
      await post(state(keys, "Somewhere with a terrace"))
      await frame.getByText("Your note: Somewhere with a terrace").waitFor()
      await frame.getByRole("button", { name: "Edit note" }).click()
      const field = frame.getByRole("textbox", { name: "Add a note to your vote" })
      assert.equal(await field.inputValue(), "Somewhere with a terrace", "the field restores the saved note")

      await field.fill("Near the office")
      await frame.getByRole("button", { name: "Send note" }).click()
      await page.waitForFunction(() => window.quiz.some((m) => m.type === "comark-quiz:answer"))
      const answer = await page.evaluate(() => window.quiz.findLast((m) => m.type === "comark-quiz:answer").detail)
      assert.equal(answer.id, "lunch")
      assert.deepEqual(answer.choice, [keys.tacos])
      assert.equal(answer.note, "Near the office")

      await post(state(keys, ""))
      await frame.getByRole("button", { name: "Add a note" }).waitFor()
      assert.equal(
        await frame.locator(".cqz-mine").isVisible(),
        false,
        "an empty note from the state clears the shown note",
      )
    } finally {
      await browser.close()
    }
  },
)
