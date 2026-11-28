import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { reviewScript } from "../../shared/review-script.ts"

const SITE = "https://shop.example.com"
const SCRIPT = reviewScript({ host: "extension" })

const html = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif">
  <h1 id="price">Pro costs 12 € a month</h1>
</body></html>`

// The content script's side: a host whose send() answers as the extension's background would, and records each message.
async function open(browser) {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } })
  await context.addInitScript(() => {
    const { value: attach } = Object.getOwnPropertyDescriptor(Element.prototype, "attachShadow")
    Element.prototype.attachShadow = function (init) {
      return Reflect.apply(attach, this, [{ ...init, mode: "open" }])
    }
    const shot = () => {
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 20
      canvas.getContext("2d").fillRect(0, 0, 20, 20)
      return canvas.toDataURL()
    }
    const json = (status, body) => ({ status, type: "application/json", text: JSON.stringify(body) })
    const threads = {}
    window.sent = []
    window.fakeHost = {
      version: 1,
      drop: "https://drop.example.com",
      targets: [
        { id: "pr-12", name: "PR 12 review", access: "Team" },
        { id: "notes", name: "My notes", access: "Private" },
      ],
      async send(message) {
        window.sent.push(message)
        if (message.type === "session") return message.clear ? null : { name: "Ada", expiresAt: Date.now() + 3600_000 }
        if (message.type === "list") return json(200, { threads: threads[message.target] || [] })
        if (message.type === "related") return json(200, { linked: false })
        if (message.type === "presence") return json(404, { message: "No one else sees this review." })
        if (message.type === "capture") return { dataUrl: shot() }
        if (message.type !== "upload") return json(200, {})
        const { data } = message
        const list = (threads[message.target] ||= [])
        const thread = {
          n: list.length + 1,
          requestId: data.requestId,
          body: data.body,
          author: { name: "Ada", image: null },
          createdAt: Date.now(),
          resolved: false,
          mine: true,
          canResolve: true,
          page: data.page,
          element: { selector: data.selector, label: data.label },
          spot: data.spot,
          box: { ox: data.ox, oy: data.oy, ow: data.ow, oh: data.oh },
          screenshot: null,
          images: [],
          replies: [],
        }
        list.push(thread)
        return json(200, { n: thread.n, thread })
      },
    }
  })
  // Nothing but the site loads: the toolbar reaches Drop only through send().
  const elsewhere = []
  await context.route("**/*", (route) => {
    const url = route.request().url()
    if (new URL(url).origin === SITE) return route.fulfill({ contentType: "text/html; charset=utf-8", body: html })
    elsewhere.push(url)
    return route.abort()
  })
  const page = await context.newPage()
  await page.goto(SITE + "/pricing")
  return { page, elsewhere, ui: page.locator("drop-review") }
}

async function inject(page) {
  await page.evaluate(() => (globalThis.__dropReviewHost = window.fakeHost))
  await page.addScriptTag({ content: SCRIPT })
}
const sent = (page, type) => page.evaluate((type) => window.sent.filter((m) => !type || m.type === type), type)

async function compose(page, ui, words) {
  await ui.getByRole("button", { name: "Comment", exact: true }).click()
  await page.mouse.click(120, 60)
  await ui.getByRole("textbox", { name: "Comment" }).fill(words)
}

test("the extension's toolbar sends through its host, to the target it names, and only on a real press", async () => {
  const browser = await chromium.launch()
  try {
    const { page, elsewhere, ui } = await open(browser)
    await inject(page)
    await ui.getByRole("button", { name: "Comment", exact: true }).waitFor()
    assert.deepEqual(
      (await sent(page, "session"))[0],
      { v: 1, type: "session", target: "pr-12" },
      "the session is the background's, for the first target",
    )

    await compose(page, ui, "Should be 10 €")
    assert.equal(await ui.locator(".target").textContent(), "PR 12 review · Team")
    // A click or a submit a script makes sends nothing.
    await page.evaluate(() => {
      const root = document.querySelector("drop-review").shadowRoot
      root.querySelector(".pop [type=submit]").click()
      root.querySelector(".pop").requestSubmit()
    })
    await page.waitForTimeout(300)
    assert.equal((await sent(page, "upload")).length, 0)
    assert.equal(await ui.locator(".pop").isVisible(), true, "the note is still there")

    await ui.getByRole("button", { name: "Send" }).click()
    await ui.getByText("Sent as #1.").waitFor()
    const [upload] = await sent(page, "upload")
    assert.equal(upload.target, "pr-12")
    assert.equal(upload.path, "/api/review/comments")
    assert.equal(upload.data.body, "Should be 10 €")
    assert.deepEqual(
      upload.files.map((file) => file.field),
      ["screenshot"],
    )
    assert.match(upload.files[0].type, /^image\/(webp|jpeg)$/)
    assert.ok(upload.files[0].base64.length > 0)
    assert.equal((await sent(page, "capture")).length, 1)
    assert.equal(
      await page.evaluate(() => getComputedStyle(document.querySelector("drop-review")).opacity),
      "1",
      "shown again",
    )

    // The switch, in the list's head, moves the toolbar to another target with its own session and threads.
    await ui.getByRole("button", { name: /open comment/ }).click()
    await ui.getByRole("combobox", { name: "Where comments go" }).selectOption("notes")
    await page.waitForFunction(() => window.sent.some((m) => m.type === "list" && m.target === "notes"))
    assert.ok((await sent(page, "session")).some((m) => m.target === "notes"))
    await compose(page, ui, "Note to self")
    assert.equal(await ui.locator(".target").textContent(), "My notes · Private")
    await ui.getByRole("button", { name: "Send" }).click()
    // The first note's "Sent as #1." may still show, so this waits for the second upload itself.
    await page.waitForFunction(() => window.sent.filter((m) => m.type === "upload").length === 2)
    assert.equal((await sent(page, "upload")).at(-1).target, "notes")
    assert.deepEqual(elsewhere, [])
  } finally {
    await browser.close()
  }
}, 30_000)

test("drop-review:yield takes the toolbar off, a second copy waits for that, and a new one starts after", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui } = await open(browser)
    await inject(page)
    await ui.getByRole("button", { name: "Comment", exact: true }).waitFor()
    await page.waitForFunction(() => window.sent.some((m) => m.type === "list"))
    // Injected again while it runs: nothing new.
    const before = (await sent(page)).length
    await inject(page)
    assert.equal(await page.locator("drop-review").count(), 1)
    assert.equal((await sent(page)).length, before)

    await page.evaluate(() => window.dispatchEvent(new Event("drop-review:yield")))
    assert.equal(await page.locator("drop-review").count(), 0)
    const after = (await sent(page)).length
    // What would make a running toolbar ask Drop again: focus, and a single-page app's new address.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"))
      history.pushState(null, "", "/plans")
      document.body.append(document.createElement("p"))
    })
    await page.waitForTimeout(1500)
    assert.equal((await sent(page)).length, after, "nothing is sent after the yield")

    await inject(page)
    await ui.getByRole("button", { name: "Comment", exact: true }).waitFor()
    await page.waitForFunction((after) => window.sent.slice(after).some((m) => m.type === "list"), after)
    assert.equal((await sent(page, "list")).at(-1).page, "/plans")
  } finally {
    await browser.close()
  }
}, 30_000)
