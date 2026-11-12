import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"

const SITE = "https://site.test"
const DROP = "https://drop.test"

// A slideover that keeps focus the way Reka UI's FocusScope does (Nuxt UI's USlideover and UModal): it listens for
// focusout on the document and takes focus back when it moves outside the dialog.
const SLIDEOVER = `<button id="open">Save change</button>
<div id="slideover" role="dialog" hidden style="position:fixed;right:0;top:0;bottom:0;width:360px;background:#fff;padding:24px">
  <label>Reason <input id="reason"></label>
</div>
<script>
  const dialog = document.getElementById("slideover"), reason = document.getElementById("reason")
  let last = null
  document.addEventListener("focusin", (e) => { if (dialog.contains(e.target)) last = e.target })
  document.addEventListener("focusout", (e) => {
    if (dialog.hidden || e.relatedTarget === null || dialog.contains(e.relatedTarget)) return
    (last || reason).focus()
  })
  document.getElementById("open").addEventListener("click", () => { dialog.hidden = false; reason.focus() })
</script>`

// A page that changes text and row styles every frame, with a row for each thread that has an element.
const BUSY = `<p id="clock"></p><ul id="rows">${Array.from({ length: 40 }, (_, i) => `<li>Row ${i}</li>`).join("")}</ul>
<script>(function tick() {
  const now = String(performance.now());
  document.getElementById("clock").textContent = now;
  for (const row of document.querySelectorAll("#rows > li")) row.style.setProperty("--frame", now);
  requestAnimationFrame(tick);
})()</script>`

function thread(n, selector, label = "li") {
  return {
    n,
    body: "Note " + n,
    resolved: false,
    replies: [],
    images: [],
    author: { name: "Ada" },
    element: { selector, label },
    spot: { x: 0, y: 0 },
    createdAt: 0,
  }
}

async function open(browser, body, threads = []) {
  const posts = []
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } })
  await context.addInitScript(
    ({ drop }) => {
      const { value: attach } = Object.getOwnPropertyDescriptor(Element.prototype, "attachShadow")
      Element.prototype.attachShadow = function (init) {
        return Reflect.apply(attach, this, [{ ...init, mode: "open" }])
      }
      sessionStorage.setItem(
        "drop-review:" + drop,
        JSON.stringify({ token: "t", expiresAt: Date.now() + 3600_000, name: "Ada" }),
      )
    },
    { drop: DROP },
  )
  const cors = {
    "access-control-allow-origin": SITE,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, PATCH",
  }
  await context.route("**/*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.hostname === "esm.sh")
      return route.fulfill({
        contentType: "text/javascript",
        headers: { "access-control-allow-origin": "*" },
        body: "export async function createContext() { return {} }\nexport async function domToCanvas() { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10; return canvas }",
      })
    if (url.origin === SITE)
      return route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><html><body>${body}<script src="${DROP}/review.js" defer></script></body></html>`,
      })
    if (url.origin !== DROP) return route.abort()
    if (url.pathname === "/review.js") return route.fulfill({ contentType: "text/javascript", body: REVIEW_SCRIPT })
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors })
    // Only comment POSTs carry the multipart body these tests record; this Drop offers no presence ticket.
    if (url.pathname === "/api/review/presence")
      return route.fulfill({ status: 404, contentType: "application/json", headers: cors, body: "{}" })
    if (request.method() === "POST") {
      posts.push(request.postDataBuffer().toString("utf8"))
      const data = JSON.parse(posts.at(-1).match(/name="data"\r\n\r\n(.*?)\r\n/s)[1])
      const saved = thread(threads.length + 1, data.selector, data.label)
      saved.body = data.body
      saved.spot = data.spot
      threads.push(saved)
      return route.fulfill({ contentType: "application/json", headers: cors, body: JSON.stringify({ n: saved.n }) })
    }
    return route.fulfill({ contentType: "application/json", headers: cors, body: JSON.stringify({ threads }) })
  })
  const page = await context.newPage()
  await page.goto(SITE + "/accountsettings")
  const ui = page.locator("drop-review")
  await ui.getByRole("button", { name: "Comment", exact: true }).waitFor()
  return { page, ui, posts }
}

test("a comment on an open slideover keeps its words when the slideover keeps focus", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui, posts } = await open(browser, SLIDEOVER)
    await page.click("#open")
    await ui.getByRole("button", { name: "Comment", exact: true }).click()
    const reason = await page.locator("#reason").boundingBox()
    await page.mouse.click(reason.x + 10, reason.y + reason.height / 2)
    const note = ui.getByRole("textbox", { name: "Comment" })
    await note.waitFor()
    await page.keyboard.type("Reason is cut off")
    assert.equal(await note.inputValue(), "Reason is cut off")
    assert.equal(await page.locator("#reason").inputValue(), "")
    await ui.getByRole("button", { name: "Send" }).click()
    await ui.getByText("Sent as #1.").waitFor()
    assert.match(posts[0], /Reason is cut off/)
    assert.equal(await page.locator("#slideover").isVisible(), true)
    // The slideover still keeps focus for itself afterwards.
    await page.click("#reason")
    await page.keyboard.type("typo")
    assert.equal(await page.locator("#reason").inputValue(), "typo")
  } finally {
    await browser.close()
  }
}, 20_000)

test("a reviewed-site popover stays open while writing and its comment is reachable after it closes", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui, posts } = await open(
      browser,
      `<button id="trigger">Details</button>
<div id="popover" role="dialog" hidden style="position:absolute;left:80px;top:60px;padding:20px;background:#eee">
  <p id="detail">A detail to review</p>
</div>
<script>
  const trigger = document.getElementById("trigger"), popover = document.getElementById("popover");
  trigger.addEventListener("click", () => { popover.hidden = !popover.hidden; });
  document.addEventListener("focusout", (e) => {
    if (e.target === trigger && !popover.contains(e.relatedTarget)) popover.hidden = true;
  });
  document.addEventListener("click", (e) => {
    if (e.target !== trigger && !popover.contains(e.target)) popover.hidden = true;
  });
</script>`,
    )
    await page.click("#trigger")
    await ui.getByRole("button", { name: "Comment", exact: true }).click()
    const detail = await page.locator("#detail").boundingBox()
    await page.mouse.click(detail.x + 20, detail.y + detail.height / 2)
    await ui.getByRole("textbox", { name: "Comment", exact: true }).fill("Check this detail")
    assert.equal(await page.locator("#popover").isVisible(), true)
    await ui.getByRole("button", { name: "Send" }).click()
    await ui.getByText("Sent as #1.").waitFor()
    assert.match(posts[0], /#detail/)
    assert.equal(await page.locator("#popover").isVisible(), true)
    await ui.locator(".pin:not([hidden])").waitFor()
    await page.click("#trigger")
    assert.equal(await page.locator("#popover").isVisible(), false)
    await ui.locator("[data-act=list]").click()
    await ui.locator(".row-item").filter({ hasText: "Check this detail" }).click()
    await ui.locator(".thread").getByText("Check this detail", { exact: true }).waitFor()
  } finally {
    await browser.close()
  }
}, 20_000)

test("pins on a page that re-renders every frame don't look for their elements every frame", async () => {
  const browser = await chromium.launch()
  try {
    // Five threads on rows, five on elements the page doesn't have.
    const threads = [
      ...Array.from({ length: 5 }, (_, i) => thread(i + 1, `#rows > li:nth-of-type(${i * 3 + 1})`)),
      ...Array.from({ length: 5 }, (_, i) => thread(i + 6, `#gone > li:nth-of-type(${i + 1})`)),
    ]
    const { page, ui } = await open(browser, BUSY, threads)
    await ui.locator(".pin:not([hidden])").first().waitFor()
    const lookups = await page.evaluate(async () => {
      let count = 0
      const { value: query } = Object.getOwnPropertyDescriptor(Document.prototype, "querySelector")
      Document.prototype.querySelector = function (selector) {
        count++
        return Reflect.apply(query, this, [selector])
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
      Document.prototype.querySelector = query
      return count
    })
    // About 60 frames: once a frame for each thread was 600. Missing ones are looked for twice a second at most.
    assert.ok(lookups <= 20, `${lookups} lookups in a second`)
    assert.equal(await ui.locator(".pin:not([hidden])").count(), 5)
    // A thread's element that shows up later still gets its pin.
    await page.evaluate(() => {
      const list = document.createElement("ul")
      list.id = "gone"
      list.innerHTML = "<li>Back</li>"
      document.body.prepend(list)
    })
    await page.waitForFunction(
      () => document.querySelector("drop-review").shadowRoot.querySelectorAll(".pin:not([hidden])").length === 6,
      null,
      { polling: 100 },
    )
  } finally {
    await browser.close()
  }
}, 20_000)

test("missing pins recover when only selector attributes change", async () => {
  const browser = await chromium.launch()
  try {
    const { page, ui } = await open(
      browser,
      '<button id="before">ID target</button><button class="before">Class target</button><button data-anchor="before">Attribute target</button>',
      [thread(1, "#late", "button"), thread(2, ".late", "button"), thread(3, '[data-anchor="late"]', "button")],
    )
    await ui.locator(".pin").first().waitFor({ state: "attached" })
    assert.equal(await ui.locator(".pin:not([hidden])").count(), 0)
    await page.evaluate(() => {
      document.getElementById("before").id = "late"
      document.querySelector(".before").className = "late"
      document.querySelector("[data-anchor]").setAttribute("data-anchor", "late")
    })
    await page.waitForFunction(
      () => document.querySelector("drop-review").shadowRoot.querySelectorAll(".pin:not([hidden])").length === 3,
      null,
      { polling: 100, timeout: 3000 },
    )
  } finally {
    await browser.close()
  }
}, 10_000)
