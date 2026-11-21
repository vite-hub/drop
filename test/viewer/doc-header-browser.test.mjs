import assert from "node:assert/strict"
import { chromium, firefox } from "playwright"
import { test } from "vite-plus/test"
import { frameAllow, previewSandbox } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"

const { withDocProperties, renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")
const { absoluteFavicons } = await import("../../server/utils/favicons.ts")
const { siteTile } = await import("../../shared/site-tile.ts")

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
    { icon: "folder", label: "Folder", value: "Plans", folder: "fold01" },
  ],
  related: [
    {
      id: "abc123",
      title: "Before and after",
      href: "https://drop.test/drops/abc123",
      icon: "https://drop.test/icon.png",
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

// A 1×1 PNG for the site icons and logos Drop serves (Playwright never routes /favicon.ico, so related drops use /icon.png here), unless a test sends them to a sign-in page as a proxy would.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
)

async function open(
  browser,
  { resources = [{ url: "https://github.com/acme/app/pull/212", title: "PR #212" }], signIn = false } = {},
) {
  const source = "---\nstatus: Ready\n---\n\n# Plan\n\nLaunch on November 18.\n"
  const { html } = await renderMarkdownCached("doc-header.md", async () => source)
  const body = absoluteFavicons(
    await withDocProperties(html, { resources, updatedAt: Date.UTC(2026, 10, 16) }),
    "https://drop.test",
  )
  const escaped = planDocument("markdown", source, false, body).replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  // Firefox needs no permission to write in a click, and Playwright's Firefox grants none.
  const context = await browser.newContext(
    browser.browserType().name() === "chromium" ? { permissions: ["clipboard-read", "clipboard-write"] } : {},
  )
  const page = await context.newPage()
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (signIn && url.hostname === "drop.test" && url.pathname === "/oauth2/start")
      return route.fulfill({ contentType: "text/html", body: "Sign in" })
    if (url.hostname === "drop.test" && /^\/(api\/favicons|agents)\/|^\/icon\.png$/.test(url.pathname))
      return signIn
        ? route.fulfill({ status: 302, headers: { location: "https://drop.test/oauth2/start" } })
        : route.fulfill({ contentType: "image/png", body: PNG })
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

      // Every link is a chip with its site's icon from Drop, the doc's own and the related drops the viewer adds alike.
      assert.deepEqual(
        await frame
          .locator('dl.cfm > div[data-key="links"] a.cp > img.cp-img')
          .evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src"))),
        ["https://drop.test/api/favicons/github.com", "https://drop.test/icon.png"],
      )
      assert.equal((await frame.locator('dl.cfm > div[data-key="links"] > dt').innerText()).trim(), "Links")
      // Related drops join the Links row after the doc's own links; their links stay in their own drops.
      const links = await frame.locator('dl.cfm > div[data-key="links"] dd a').allTextContents()
      assert.deepEqual(links, ["PR #212", "Before and after"])
      assert.equal(await frame.locator(".drop-links-toggle").count(), 0, "a short row shows every link")

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

      // The doc moves to another folder while the header stays: the list and Open folder follow the new folder, and a
      // late answer for the old one is ignored.
      const moved = {
        ...HEADER,
        facts: HEADER.facts.map((f) => (f.folder ? { ...f, value: "Ideas", folder: "fold02" } : f)),
      }
      const asked = await page.evaluate(() => window.posts.filter((m) => m.type === "doc-folder").length)
      await page.evaluate((header) => window.tell(header), moved)
      const ideas = frame.getByRole("button", { name: "Ideas" })
      await ideas.hover()
      await page.waitForFunction((n) => window.posts.filter((m) => m.type === "doc-folder").length > n, asked)
      await page.evaluate((folder) => window.tell({ type: "doc-folder-items", folder }), FOLDER)
      await ideas.click()
      await list.locator("p").waitFor()
      assert.equal(await list.getByRole("button", { name: "Open folder" }).count(), 0, "the old folder's rows are gone")
      const IDEAS = { ...FOLDER, id: "fold02", title: "Ideas" }
      await page.evaluate((folder) => window.tell({ type: "doc-folder-items", folder }), IDEAS)
      await list.getByRole("button", { name: "Open folder" }).evaluate((el) => el.click())
      await page.waitForFunction(() => window.posts.some((m) => m.type === "doc-open" && m.id === "fold02"))
      await page.evaluate((header) => window.tell(header), HEADER)

      // Copy asks for the Markdown when the pointer reaches it, and writes it in the click. The button stays the
      // same element through another header, so the press can't be lost and focus stays.
      const copy = frame.getByRole("button", { name: "Copy as Markdown" })
      const waitForIcon = (shown) =>
        frame.waitForFunction((visibleIcon) => {
          const icons = document.querySelectorAll('[data-slot="copy-button-icon"] > [data-icon]')
          return (
            icons.length === 2 &&
            [...icons].every(
              (icon) => getComputedStyle(icon).opacity === (icon.dataset.icon === visibleIcon ? "1" : "0"),
            )
          )
        }, shown)
      await waitForIcon("copy")
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
      await waitForIcon("check")
      await copy.locator(":scope:not([data-copied])").waitFor({ timeout: 3000 })
      await waitForIcon("copy")

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
      await page.waitForFunction(() => window.posts.filter((m) => m.type === "doc-open").length === 4)
      assert.deepEqual(
        (await docPosts(page))
          .filter((m) => m.type === "doc-open" || m.type === "doc-action")
          .map((m) => m.action ?? m.id),
        ["new001", "fold01", "fold02", "download", "abc123"],
      )
      assert.equal(
        (await page.evaluate(() => window.posts)).some((m) => m.type === "key" && m.key === "Escape"),
        false,
      )

      // A copy the viewer made (its shortcut) shows on the button too; a second header doesn't add links again.
      await page.evaluate(() => window.tell({ type: "doc-copied" }))
      assert.equal(await copy.getAttribute("data-copied"), "")
      assert.equal(await frame.locator('dl.cfm > div[data-key="links"] dd a').count(), 2)

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

// portal#1254's doc listed six links and thirteen related drops, and its Links row filled half a screen.
test("a long Links row shows its first links and opens the rest behind N more", { timeout: 30000 }, async () => {
  const browser = await chromium.launch()
  try {
    const own = Array.from({ length: 6 }, (_, i) => ({
      url: `https://github.com/acme/app/pull/${i + 1}`,
      title: `PR #${i + 1}`,
    }))
    const { page, frame } = await open(browser, { resources: own })
    const chips = frame.locator('dl.cfm > div[data-key="links"] dd a.cp')
    const visible = () => chips.evaluateAll((all) => all.filter((a) => a.checkVisibility()).map((a) => a.textContent))
    assert.equal(await frame.locator(".drop-links-toggle").count(), 0, "six links fit")

    const related = Array.from({ length: 5 }, (_, i) => ({
      id: `rel00${i}`,
      title: `Related ${i + 1}`,
      href: `https://drop.test/drops/rel00${i}`,
      icon: "https://drop.test/icon.png",
    }))
    await page.evaluate((header) => window.tell(header), { ...HEADER, related })
    const toggle = frame.locator(".drop-links-toggle")
    const label = () => toggle.evaluate((button) => getComputedStyle(button, "::before").content)
    await toggle.waitFor()
    assert.deepEqual(
      await visible(),
      own.map((r) => r.title),
      "the doc's own links come first",
    )
    assert.equal(await label(), '"5 more"')
    assert.equal(await toggle.getAttribute("aria-expanded"), "false")
    const folded = await frame.locator('dl.cfm > div[data-key="links"] > dd').evaluate((dd) => dd.offsetHeight)

    await toggle.focus()
    await page.keyboard.press("Enter")
    await page.keyboard.press("Tab")
    assert.equal(await frame.evaluate(() => document.activeElement.textContent), "Related 1")
    assert.equal((await visible()).length, 11)
    assert.equal(await label(), '"Show less"')
    assert.equal(await toggle.getAttribute("aria-label"), "Show fewer links")
    await frame.waitForFunction(() => !document.querySelector('div[data-key="links"] > dd').getAnimations().length)
    assert.ok((await frame.locator('dl.cfm > div[data-key="links"] > dd').evaluate((dd) => dd.offsetHeight)) >= folded)

    // Another header keeps it open; the row folds again from the button.
    await page.evaluate((header) => window.tell(header), { ...HEADER, related: related.slice(0, 4) })
    assert.equal((await visible()).length, 10)
    await frame.getByRole("button", { name: "Show fewer links" }).click()
    assert.deepEqual(
      await visible(),
      own.map((r) => r.title),
    )
    assert.equal(await label(), '"4 more"')

    // Paper gets every link.
    await page.emulateMedia({ media: "print" })
    assert.equal((await visible()).length, 10)
  } finally {
    await browser.close()
  }
})

test("comments on folded links have a pin by the disclosure", { timeout: 30000 }, async () => {
  const browser = await chromium.launch()
  try {
    const resources = Array.from({ length: 8 }, (_, i) => ({
      url: `https://github.com/acme/app/pull/${i + 1}`,
      title: `Resource ${i + 1}`,
    }))
    const { page, frame } = await open(browser, { resources })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.evaluate((header) => {
      window.tell(header)
      window.tell({
        type: "markers",
        markers: [{ id: "c1", kind: "text", selector: 'dl.cfm div[data-key="links"] dd', quote: "Resource 7", n: 1 }],
      })
    }, HEADER)
    const toggle = frame.getByRole("button", { name: "Show 3 more links" })
    const pin = frame.locator('drop-comments [data-slot="comment-mark-pin"][data-id="c1"]')
    const foldedPin = pin.and(frame.locator(".away"))
    const expandedPin = pin.and(frame.locator(":not(.away)"))
    await foldedPin.waitFor()
    await page.evaluate(() => window.tell({ type: "focus", id: "c1", open: true }))
    await page.waitForFunction(() => window.posts.some((m) => m.type === "marker" && m.id === "c1" && m.focused))

    await toggle.click()
    await expandedPin.waitFor()
    await frame.getByRole("button", { name: "Show fewer links" }).click()
    await foldedPin.waitFor()
  } finally {
    await browser.close()
  }
})

test("a quote across two links stays anchored when the disclosure appears", { timeout: 30000 }, async () => {
  const browser = await chromium.launch()
  try {
    const resources = Array.from({ length: 8 }, (_, index) => ({
      url: `https://github.com/acme/app/pull/${index + 1}`,
      title: `Resource ${index + 1}`,
    }))
    const { page, frame } = await open(browser, { resources })
    await page.emulateMedia({ reducedMotion: "reduce" })
    const selector = 'dl.cfm div[data-key="links"] dd'
    const selectQuote = () =>
      frame.locator(selector).evaluate((row) => {
        const links = row.querySelectorAll("a.cp")
        const range = document.createRange()
        range.setStart(links[5], 0)
        range.setEnd(links[6], links[6].childNodes.length)
        const selection = getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        const quote = selection.toString().replace(/\s+/g, "")
        selection.removeAllRanges()
        return quote
      })
    const quote = "Resource 6 Resource 7"
    assert.equal(await selectQuote(), "Resource6Resource7")

    await page.evaluate(
      ({ selector, quote }) => {
        window.tell({ type: "markers", markers: [{ id: "cross", kind: "text", selector, quote, n: 1 }] })
      },
      { selector, quote },
    )
    const pin = frame.locator('drop-comments [data-slot="comment-mark-pin"][data-id="cross"]')
    const foldedPin = pin.and(frame.locator(".away"))
    const expandedPin = pin.and(frame.locator(":not(.away)"))
    await expandedPin.waitFor()

    await page.evaluate((header) => window.tell(header), HEADER)
    const toggle = frame.getByRole("button", { name: "Show 3 more links" })
    await toggle.waitFor()
    assert.equal(await pin.count(), 1, "the late related drop must not unplace the comment")
    await foldedPin.waitFor()
    await toggle.click()
    await expandedPin.waitFor()
    assert.equal(await selectQuote(), "Resource6Resource7")
    await frame.getByRole("button", { name: "Show fewer links" }).click()
    await foldedPin.waitFor()
  } finally {
    await browser.close()
  }
})

test("reopening Links mid-collapse animates to the expanded height", { timeout: 30000 }, async () => {
  const browser = await chromium.launch()
  try {
    const resources = Array.from({ length: 8 }, (_, i) => ({
      url: `https://github.com/acme/app/pull/${i + 1}`,
      title: `A long resource label ${i + 1}`,
    }))
    const { page, frame } = await open(browser, { resources })
    await page.evaluate((header) => window.tell(header), HEADER)
    const toggle = frame.getByRole("button", { name: "Show 3 more links" })
    await toggle.click()
    const row = frame.locator('dl.cfm > div[data-key="links"] > dd')
    await frame.waitForFunction(
      () => !document.querySelector('dl.cfm > div[data-key="links"] > dd').getAnimations().length,
    )
    const { target, expanded } = await row.evaluate((dd) => {
      const button = dd.querySelector(".drop-links-toggle")
      const expanded = dd.offsetHeight
      button.click()
      const [collapse] = dd.getAnimations()
      collapse.pause()
      collapse.currentTime = 120
      button.click()
      const [reopen] = dd.getAnimations()
      return { target: reopen?.effect.getKeyframes().at(-1).height, expanded }
    })
    assert.equal(target, `${expanded}px`)
  } finally {
    await browser.close()
  }
})

// Quiver's oauth2-proxy answered /api/favicons/ with its sign-in page, and every chip lost its icon to an empty space.
test("a site icon that doesn't load shows its site's letter tile", { timeout: 30000 }, async () => {
  const browser = await chromium.launch()
  try {
    const { page, frame } = await open(browser, {
      signIn: true,
      resources: [{ url: "https://github.com/acme/app/pull/212" }, { url: "https://acme.netlify.app/" }],
    })
    await page.evaluate((header) => window.tell(header), HEADER)
    const icons = frame.locator('dl.cfm > div[data-key="links"] a.cp > img.cp-img')
    await frame.waitForFunction(() =>
      Array.from(document.querySelectorAll("img.cp-img")).every(
        (img) => img.src.startsWith("data:") && img.naturalWidth,
      ),
    )
    // Each takes its site's letter tile: GitHub's G for the doc's pull request.
    const first = decodeURIComponent(await icons.first().getAttribute("src"))
    assert.match(first, />G<\/text>/)
    const tenant = decodeURIComponent(await icons.nth(1).getAttribute("src"))
    assert.equal(tenant, `data:image/svg+xml,${siteTile("acme")}`)
    // The agent's logo, also blocked, goes; its name stays.
    await frame.getByRole("button", { name: "See more" }).click()
    const who = frame.locator(".drop-who")
    await frame.waitForFunction(() => !document.querySelector(".drop-who .drop-logo"))
    assert.match(await who.innerText(), /Claude Code/)
  } finally {
    await browser.close()
  }
})

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
