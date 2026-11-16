import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { previewSandbox } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

const { withDocProperties, renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

const HEADER = {
  type: "doc-header",
  actions: [
    { id: "markdown", label: "Copy as Markdown", kbd: "M" },
    { id: "download", label: "Download original", kbd: "D" },
    { id: "pdf", label: "Export as PDF" },
  ],
  copied: false,
  facts: [
    { icon: "views", label: "Views", value: "38", detail: "21 signed in · 12 anonymous · 5 agents" },
    { icon: "file", label: "File", value: "plan.md", detail: "Markdown · 14.2 KB" },
  ],
  related: [{ id: "abc123", title: "Before and after", href: "https://drop.test/drops/abc123" }],
  links: [
    { url: "https://linear.app/acme/issue/ACM-7", label: "ACM-7" },
    { url: "https://github.com/acme/app/pull/212", label: "acme/app#212" },
  ],
  icon: "https://drop.test/favicon.ico",
}

// A Markdown doc with a front matter box in the viewer's frame, as DropViewer renders one without a content origin.
async function open(browser) {
  const source = "---\nstatus: Ready\n---\n\n# Plan\n\nLaunch on November 18.\n"
  const { html } = await renderMarkdownCached("doc-header.md", async () => source)
  const body = await withDocProperties(html, {
    resources: [{ url: "https://github.com/acme/app/pull/212", title: "PR #212" }],
    updatedAt: Date.UTC(2026, 10, 16),
  })
  const escaped = planDocument("markdown", source, false, body).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  const page = await browser.newPage()
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== "drop.test" || url.pathname !== "/") return route.abort()
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<iframe sandbox="${previewSandbox("markdown")}" srcdoc="${escaped}"></iframe>
        <script>window.posts = []; addEventListener("message", (e) => { if (e.data?.__drop) window.posts.push(e.data); });
          window.tell = (message) => frames[0].postMessage({ __drop: true, ...message }, "*");</script>`,
    })
  })
  await page.goto("https://drop.test/")
  await page.waitForFunction(() => window.posts.some((m) => m.type === "ready"))
  return { page, frame: page.frames()[1] }
}

const docPosts = (page) => page.evaluate(() => window.posts.filter((m) => m.type.startsWith("doc-")))

test(
  "a doc's header gets site icons, related drops, its buttons, and its facts under See more",
  { timeout: 30000 },
  async () => {
    const browser = await chromium.launch()
    try {
      const { page, frame } = await open(browser)
      await page.evaluate((header) => window.tell(header), HEADER)
      await frame.locator("drop-doc-actions button").first().waitFor()

      // Every link starts on its site's icon; here none loads (the frame reaches no site), so each ends on the plain link
      // icon, never a broken image.
      await frame.waitForFunction(() => !document.querySelector("dl.cfm img.drop-favicon"))
      assert.equal(await frame.locator("dl.cfm a[href^='https:'] > span.drop-favicon svg").count(), 3)
      assert.equal((await frame.locator('dl.cfm > div[data-key="links"] > dt').innerText()).trim(), "Links")
      // Related drops and their links join the Links row; a link the doc lists already isn't repeated.
      const links = await frame.locator('dl.cfm > div[data-key="links"] dd a').allTextContents()
      assert.deepEqual(links, ["PR #212", "Before and after", "ACM-7"])

      // See more unfolds the facts, which stay out of reach while folded.
      const facts = frame.locator("drop-doc-facts")
      assert.equal(await facts.evaluate((el) => el.inert), true)
      await frame.getByRole("button", { name: "See more" }).click()
      assert.equal(await facts.evaluate((el) => el.inert), false)
      assert.equal(await frame.getByRole("button", { name: "See less" }).getAttribute("aria-expanded"), "true")
      assert.match(await facts.innerText(), /Views\s+38\s*· 21 signed in/)

      // Copy is the button; its arrow's menu holds the rest, and Escape closes the menu without reaching Drop.
      await frame.getByRole("button", { name: "Copy as Markdown" }).click()
      await frame.getByRole("button", { name: "More ways to save this doc" }).click()
      await frame.getByRole("menuitem", { name: /Export as PDF/ }).waitFor()
      await frame.locator("body").press("Escape")
      assert.equal(
        await frame.getByRole("button", { name: "More ways to save this doc" }).getAttribute("aria-expanded"),
        "false",
      )
      await frame.getByRole("button", { name: "More ways to save this doc" }).click()
      await frame.getByRole("menuitem", { name: /Download original/ }).click()
      await frame.getByRole("link", { name: "Before and after" }).click()
      assert.deepEqual(
        (await docPosts(page)).map((m) => m.action ?? m.id),
        ["markdown", "download", "abc123"],
      )
      assert.equal(
        (await page.evaluate(() => window.posts)).some((m) => m.type === "key" && m.key === "Escape"),
        false,
      )

      // Copied, as the viewer says; and a second header replaces the first rather than adding to it.
      await page.evaluate((header) => window.tell({ ...header, copied: true }), HEADER)
      await frame.getByRole("button", { name: "Copy as Markdown" }).getByText("Copied").waitFor()
      assert.equal(await frame.locator('dl.cfm > div[data-key="links"] dd a').count(), 3)

      // Paper gets the doc, not the buttons.
      await page.emulateMedia({ media: "print" })
      assert.equal(
        await frame.evaluate(() => getComputedStyle(document.querySelector("drop-doc-actions")).display),
        "none",
      )
    } finally {
      await browser.close()
    }
  },
)
