import assert from "node:assert/strict"
import { chromium, firefox } from "playwright"
import { test } from "vite-plus/test"
import { frameAllow, previewSandbox } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

const { withDocProperties, renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

const HEADER = {
  type: "doc-header",
  actions: [
    { id: "markdown", label: "Copy as Markdown", kbd: "M" },
    { id: "download", label: "Download original", kbd: "D" },
    { id: "pdf", label: "Export as PDF" },
  ],
  facts: [
    {
      icon: "views",
      label: "Views",
      value: "38 views",
      parts: [
        { icon: "person", n: 21, tip: "21 by people signed in" },
        { icon: "agent", n: 17, tip: "17 by agents reading it, yours included" },
      ],
    },
    { icon: "file", label: "File", value: "plan.md", detail: "Markdown · 14.2 KB" },
    {
      icon: "person",
      label: "Dropped by",
      value: "Max",
      who: {
        name: "Max",
        image: null,
        agent: { label: "Claude Code", logo: "https://drop.test/agents/claude.svg" },
        tip: "via Executor · claude-opus-5-5 · high reasoning",
      },
    },
    { icon: "folder", label: "Folder", value: "Plans", folder: true },
  ],
  related: [
    {
      id: "abc123",
      title: "Before and after",
      href: "https://drop.test/drops/abc123",
      icon: "https://drop.test/favicon.ico",
    },
  ],
  links: [
    { url: "https://linear.app/acme/issue/ACM-7", label: "ACM-7", icon: "https://drop.test/api/favicons/linear.app" },
    {
      url: "https://github.com/acme/app/pull/212",
      label: "acme/app#212",
      icon: "https://drop.test/api/favicons/github.com",
    },
  ],
}

// A Markdown doc with a front matter box in the viewer's frame, as DropViewer renders one without a content origin.
const FOLDER = {
  id: "fold01",
  title: "Plans",
  items: [
    {
      id: "new001",
      title: "Launch checklist",
      icon: "doc",
      at: "2 hr. ago",
      tip: "Nov 17, 2026, 9:00 AM",
      current: false,
    },
    { id: "this01", title: "Plan", icon: "doc", at: "1 day ago", tip: "Nov 16, 2026, 9:00 AM", current: true },
  ],
}

async function open(browser) {
  const source = "---\nstatus: Ready\n---\n\n# Plan\n\nLaunch on November 18.\n"
  const { html } = await renderMarkdownCached("doc-header.md", async () => source)
  const body = await withDocProperties(html, {
    resources: [{ url: "https://github.com/acme/app/pull/212", title: "PR #212" }],
    updatedAt: Date.UTC(2026, 10, 16),
  })
  const escaped = planDocument("markdown", source, false, body).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  // Firefox needs no permission to write in a click, and Playwright's Firefox grants none.
  const context = await browser.newContext(
    browser.browserType().name() === "chromium" ? { permissions: ["clipboard-read", "clipboard-write"] } : {},
  )
  const page = await context.newPage()
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== "drop.test" || url.pathname !== "/") return route.abort()
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<iframe sandbox="${previewSandbox("markdown")}" allow="${frameAllow("markdown")}" srcdoc="${escaped}"></iframe>
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

      // Every link is a chip with its site's icon from Drop, the doc's own and the ones the viewer adds alike.
      assert.deepEqual(
        await frame
          .locator('dl.cfm > div[data-key="links"] a.cp > img.cp-img')
          .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src"))),
        ["/api/favicons/github.com", "https://drop.test/favicon.ico", "https://drop.test/api/favicons/linear.app"],
      )
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
      assert.match(await facts.innerText(), /Views\s+38 views\s+21\s+17/)
      assert.equal(await facts.locator(".drop-fact-part").first().getAttribute("title"), "21 by people signed in")

      // "Dropped by": the person, then the agent, with the rest on hover.
      const who = facts.locator(".drop-who")
      assert.match(await who.innerText(), /Max\s*\u00b7\s*Claude Code/)
      assert.equal(await who.getAttribute("title"), "via Executor \u00b7 claude-opus-5-5 \u00b7 high reasoning")

      // The folder opens a list of its drops, asked for when the pointer reaches it, this doc marked and focused.
      const folder = frame.getByRole("button", { name: "Plans" })
      await folder.hover()
      await page.waitForFunction(() => window.posts.some((m) => m.type === "doc-folder"))
      await page.evaluate((folder) => window.tell({ type: "doc-folder-items", folder }), FOLDER)
      await folder.click()
      const list = frame.locator("drop-folder-menu")
      await list.locator("button").first().waitFor()
      assert.equal(await list.evaluate((el) => el.matches(":popover-open")), true)
      await frame.locator('.drop-folder[aria-expanded="true"]').waitFor()
      await list.locator('button[aria-current="page"]:focus').waitFor()
      await page.keyboard.press("ArrowUp")
      assert.match(await frame.evaluate(() => document.activeElement.textContent), /Launch checklist/)
      await page.keyboard.press("Escape")
      assert.equal(await list.evaluate((el) => el.matches(":popover-open")), false)
      assert.equal(await frame.evaluate(() => document.activeElement.textContent), "Plans", "focus goes back")
      await folder.click()
      await list.getByRole("button", { name: /Launch checklist/ }).click()
      await list.getByRole("button", { name: "Open folder" }).evaluate((el) => el.click())

      // Copy asks for the Markdown when the pointer reaches it, and writes it in the click. The button stays the
      // same element through another header, so the press can't be lost and focus stays.
      const copy = frame.getByRole("button", { name: "Copy as Markdown" })
      await copy.evaluate((el) => (el.dataset.same = "1"))
      await page.evaluate((header) => window.tell(header), HEADER)
      assert.equal(await copy.getAttribute("data-same"), "1")
      await copy.hover()
      await page.waitForFunction(() => window.posts.some((m) => m.type === "doc-intent"))
      await page.evaluate(() => window.tell({ type: "doc-markdown", text: "# Plan\n" }))
      await copy.click()
      await page.waitForFunction(() => window.posts.some((m) => m.type === "doc-copied"))
      assert.deepEqual(await page.evaluate(() => window.posts.find((m) => m.type === "doc-copied")), {
        __drop: true,
        type: "doc-copied",
        ok: true,
      })
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "# Plan\n")
      assert.equal(await copy.getAttribute("data-copied"), "")
      assert.equal(await copy.innerText(), "Copy", "the label stays")
      assert.equal(await frame.locator(".drop-note").textContent(), "Markdown copied")
      await copy.locator(":scope:not([data-copied])").waitFor({ timeout: 3000 })

      // The arrow's menu is a popover; Escape closes it without reaching Drop.
      const arrow = frame.getByRole("button", { name: "More ways to save this doc" })
      await arrow.click()
      await frame.getByRole("menuitem", { name: /Export as PDF/ }).waitFor()
      // The popover's toggle event, which sets it and moves focus in, comes a task later.
      await frame.locator('[aria-label="More ways to save this doc"][aria-expanded="true"]').waitFor()
      await frame.locator("#drop-doc-menu button:focus").waitFor()
      await page.keyboard.press("ArrowDown")
      assert.match(await frame.evaluate(() => document.activeElement.textContent), /Download original/)
      await page.keyboard.press("Escape")
      // The popover's toggle event, which sets it, comes a task later.
      await frame.locator('[aria-label="More ways to save this doc"][aria-expanded="false"]').waitFor()
      await arrow.click()
      await frame.getByRole("menuitem", { name: /Download original/ }).click()
      await frame.getByRole("link", { name: "Before and after" }).click()
      await page.waitForFunction(() => window.posts.filter((m) => m.type === "doc-open").length === 3)
      assert.deepEqual(
        (await docPosts(page))
          .filter((m) => m.type === "doc-open" || m.type === "doc-action")
          .map((m) => m.action ?? m.id),
        ["new001", "fold01", "download", "abc123"],
      )
      assert.equal(
        (await page.evaluate(() => window.posts)).some((m) => m.type === "key" && m.key === "Escape"),
        false,
      )

      // A copy the viewer made (its shortcut) shows on the button too; a second header doesn't add links again.
      await page.evaluate(() => window.tell({ type: "doc-copied" }))
      assert.equal(await copy.getAttribute("data-copied"), "")
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

test("Copy says so in the frame when the Markdown doesn't load", { timeout: 30000 }, async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser)
    await page.evaluate((header) => window.tell(header), HEADER)
    const copy = frame.getByRole("button", { name: "Copy as Markdown" })
    await copy.click()
    await page.waitForFunction(() => window.posts.some((m) => m.type === "doc-intent"))
    assert.equal(await copy.getAttribute("aria-busy"), "true")
    await page.evaluate(() => window.tell({ type: "doc-markdown", text: null }))
    await page.waitForFunction(() => window.posts.some((m) => m.type === "doc-copied"))
    const result = await page.evaluate(() => window.posts.find((m) => m.type === "doc-copied"))
    assert.equal(result.ok, false)
    assert.match(result.error, /didn't load/)
    const note = frame.locator(".drop-note")
    assert.equal(await note.textContent(), "Couldn't copy")
    assert.ok((await note.boundingBox()).width > 40, "the failure shows, not only to screen readers")
    assert.equal(await copy.getAttribute("data-copied"), null)
  } finally {
    await browser.close()
  }
})

// Firefox 159 failed to copy in production (Drop comment #12): the frame writes in Firefox too, and says when it can't.
test("Copy writes from the frame in Firefox", { timeout: 30000 }, async () => {
  const browser = await firefox.launch()
  try {
    const { page, frame } = await open(browser)
    await page.evaluate((header) => window.tell(header), HEADER)
    const copy = frame.getByRole("button", { name: "Copy as Markdown" })
    await copy.hover()
    await page.waitForFunction(() => window.posts.some((m) => m.type === "doc-intent"))
    await page.evaluate(() => window.tell({ type: "doc-markdown", text: "# Plan\n" }))
    await copy.click()
    await page.waitForFunction(() => window.posts.some((m) => m.type === "doc-copied"))
    assert.deepEqual(await page.evaluate(() => window.posts.find((m) => m.type === "doc-copied")), {
      __drop: true,
      type: "doc-copied",
      ok: true,
    })
    assert.equal(await copy.getAttribute("data-copied"), "")
  } finally {
    await browser.close()
  }
})
