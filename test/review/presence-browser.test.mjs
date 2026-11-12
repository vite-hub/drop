import assert from "node:assert/strict"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { REVIEW_SCRIPT } from "../../shared/review-script.ts"

const SITE = "https://site.test"
const DROP = "https://drop.test"
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type" }

// A stand-in for the presence client Drop serves at /review-presence.js: the reviewer is Ada (client 1), and the test
// adds the others through window.__presence, as their awareness would arrive.
const CLIENT = `export function connectRealtimeRoom(definition, room, options) {
  const listeners = new Set(), others = new Map(), local = {};
  const me = { id: "ada", name: "Ada", color: "#2563EB", clientId: 1 };
  const emit = () => listeners.forEach((listener) => listener());
  window.__presence = {
    definition, room, options, local,
    set(clientId, person, state) { others.set(clientId, { person: { ...person, clientId }, state }); emit(); },
    leave(clientId) { others.delete(clientId); emit(); },
  };
  return {
    clientId: 1,
    people: () => [me, ...[...others.values()].map((other) => other.person)],
    states: () => new Map([...others].map(([id, other]) => [id, other.state])),
    status: () => "connected",
    setLocal(field, value) { if (value === null) delete local[field]; else local[field] = value; },
    onUpdate(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { window.__presence.destroyed = true; },
  };
}`

async function open(browser, { presence = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 900, height: 600 } })
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
  const seen = { threads: 0, client: 0, tickets: [] }
  await context.route("**/*", (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === SITE)
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><body style="margin:0"><h1 style="margin:200px 100px;width:400px;height:100px">Pro</h1><script src="${DROP}/review.js"></script>`,
      })
    if (url.origin !== DROP) return route.abort()
    if (url.pathname === "/review.js") return route.fulfill({ contentType: "text/javascript", body: REVIEW_SCRIPT })
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS })
    if (url.pathname === "/review-presence.js") {
      seen.client++
      return route.fulfill({ contentType: "text/javascript", headers: CORS, body: CLIENT })
    }
    if (url.pathname === "/api/review/presence") {
      seen.tickets.push(request.headers().authorization)
      return presence
        ? route.fulfill({
            contentType: "application/json",
            headers: CORS,
            body: JSON.stringify({
              room: "r0",
              ticket: "tk",
              you: { id: "ada", name: "Ada" },
              expiresAt: Date.now() + 3600_000,
            }),
          })
        : route.fulfill({
            status: 404,
            contentType: "application/json",
            headers: CORS,
            body: JSON.stringify({ message: "Only people the review is shared with see who else is here." }),
          })
    }
    if (url.pathname === "/api/review/related")
      return route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify({ any: false }) })
    seen.threads++
    return route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify({ threads: [] }) })
  })
  const page = await context.newPage()
  await page.goto(SITE + "/")
  await page.locator("drop-review drop-review-pill button.mark").waitFor()
  return { context, page, seen, people: page.locator("drop-review [data-act=people]") }
}

const BEN = { id: "ben", name: "Ben", color: "#E11D48" }

test("review.js loads the first comment from its only other reviewer", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch()
  try {
    const { context, page, seen, people } = await open(browser)
    await page.waitForFunction(() => window.__presence)
    await page.evaluate((ben) => window.__presence.set(2, ben, { active: true, at: "https://site.test/" }), BEN)
    await people.waitFor({ state: "visible" })
    const before = seen.threads
    await page.evaluate(
      (ben) => window.__presence.set(2, ben, { active: true, at: "https://site.test/", comments: "first" }),
      BEN,
    )
    for (let tries = 0; seen.threads === before && tries < 20; tries++) await page.waitForTimeout(50)
    assert.ok(seen.threads > before, "the first comment loads this page's threads immediately")

    // Further awareness updates with the same notification do not load the threads again.
    const after = seen.threads
    await page.evaluate(
      (ben) => window.__presence.set(2, ben, { active: false, at: "https://site.test/", comments: "first" }),
      BEN,
    )
    await page.waitForTimeout(100)
    assert.equal(seen.threads, after)
    await context.close()
  } finally {
    await browser.close()
  }
})

test(
  "a site's popover stays open while commenting with presence, and its saved comment stays reachable",
  { timeout: 30_000 },
  async () => {
    const browser = await chromium.launch()
    try {
      const { context, page } = await open(browser)
      await page.waitForFunction(() => window.__presence)
      const saved = []
      await page.route(DROP + "/api/review/comments*", async (route) => {
        const request = route.request()
        if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS })
        let body = { threads: saved }
        if (request.method() === "POST") {
          const form = await new Response(request.postDataBuffer(), {
            headers: { "content-type": request.headers()["content-type"] },
          }).formData()
          const data = JSON.parse(form.get("data"))
          saved.push({
            n: 1,
            body: data.body,
            element: { selector: data.selector, label: data.label },
            spot: data.spot,
            author: { name: "Ada" },
            resolved: false,
            replies: [],
            images: [],
            createdAt: Date.now(),
          })
          body = { n: 1, thread: saved[0] }
        }
        return route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify(body) })
      })
      await page.evaluate(() => {
        // A page-owned menu, dismissed by a click outside it, like a portal-mounted application popover.
        document.body.insertAdjacentHTML(
          "beforeend",
          `<button id="details-trigger">Details</button>
        <div id="details" hidden style="position:fixed;left:100px;top:100px;background:white;padding:20px">
          <p id="detail-note">The details in this popover.</p>
        </div>`,
        )
        const trigger = document.getElementById("details-trigger"),
          details = document.getElementById("details")
        trigger.addEventListener("click", () => {
          details.hidden = false
        })
        document.addEventListener("click", (event) => {
          if (!details.contains(event.target) && event.target !== trigger) details.hidden = true
        })
      })
      await page.locator("#details-trigger").click()
      const ui = page.locator("drop-review")
      await ui.getByRole("button", { name: "Comment", exact: true }).click()
      assert.equal(await page.locator("#details").isVisible(), true)
      const box = await page.locator("#detail-note").boundingBox()
      await page.mouse.click(box.x + 20, box.y + 10)
      await ui.getByRole("textbox", { name: "Comment", exact: true }).fill("Keep these details")
      assert.equal(await page.locator("#details").isVisible(), true)
      await ui.getByRole("button", { name: "Send", exact: true }).click()
      await ui.getByRole("button", { name: "Comment #1 by Ada", exact: true }).waitFor()
      assert.equal(
        typeof (await page.evaluate(() => window.__presence.local.comments)),
        "string",
        "saving the comment from the POST response still notifies other reviewers",
      )
      assert.equal(saved[0].element.selector, "#detail-note")
      assert.equal(await page.locator("#details").isVisible(), true)
      // Close it through the page's own outside-click handler, then reach the comment through the review's list.
      await page.locator("h1").click()
      assert.equal(await page.locator("#details").isVisible(), false)
      await ui.locator("[data-act=list]").click()
      await ui.locator(".row-item").filter({ hasText: "Keep these details" }).click()
      assert.equal(await ui.locator(".thread").getByText("Keep these details", { exact: true }).isVisible(), true)
      await context.close()
    } finally {
      await browser.close()
    }
  },
)

test("review.js shows who else is on the review and their cursors on this page", { timeout: 30_000 }, async () => {
  const browser = await chromium.launch()
  try {
    const { context, page, seen, people } = await open(browser)
    await page.waitForFunction(() => window.__presence)
    const joined = await page.evaluate(() => ({ ...window.__presence, set: undefined, leave: undefined }))
    assert.equal(joined.definition, "presence")
    assert.equal(joined.room, "r0")
    assert.deepEqual(joined.options, { origin: DROP, params: { ticket: "tk" }, identity: { id: "ada", name: "Ada" } })
    assert.deepEqual(joined.local, { active: true, at: SITE + "/" })
    assert.deepEqual(seen.tickets, ["Bearer t"], "the ticket is asked for with the review token")
    assert.equal(await people.isHidden(), true, "nobody else here: no faces")

    // Ada's own other tab, in Drop, is no one else.
    await page.evaluate(() =>
      window.__presence.set(3, { id: "ada", name: "Ada", color: "#2563EB" }, { active: true, at: null }),
    )
    await page.waitForTimeout(50)
    assert.equal(await people.isHidden(), true, "Ada's other tab shows no face")

    // Ben comes, pointing at the middle of the heading.
    await page.evaluate(
      (ben) =>
        window.__presence.set(2, ben, {
          active: true,
          at: "https://site.test/",
          cursor: { selector: "body > h1", x: 500, y: 500 },
        }),
      BEN,
    )
    await people.waitFor()
    assert.equal(await people.getAttribute("aria-label"), "Here now: Ben. Hide cursors")
    assert.equal(await people.getAttribute("aria-pressed"), "true")
    const cursor = page.locator("drop-review .pc")
    await cursor.waitFor()
    assert.equal(await cursor.textContent(), "Ben")
    const at = await cursor.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform))
    assert.ok(
      Math.abs(at.m41 - 300) < 2 && Math.abs(at.m42 - 250) < 2,
      `cursor at the heading's middle, got ${at.m41},${at.m42}`,
    )
    assert.equal(await cursor.evaluate((node) => getComputedStyle(node).pointerEvents), "none")

    // Ada's pointer goes up as the element under it and the spot inside it.
    await page.mouse.move(150, 225)
    await page.waitForFunction(() => window.__presence.local.cursor)
    assert.deepEqual(await page.evaluate(() => window.__presence.local.cursor), {
      selector: "body > h1",
      x: 125,
      y: 250,
    })

    // Ben goes away: his face dims and says so.
    await page.evaluate((ben) => window.__presence.set(2, ben, { active: false, at: "https://site.test/" }), BEN)
    await page.waitForFunction(() =>
      document.querySelector("drop-review").shadowRoot.querySelector("[data-act=people] .face.idle"),
    )
    assert.equal(await people.getAttribute("aria-label"), "Here now: Ben (away). Hide cursors")

    // Pressing the faces hides the cursors, and the browser remembers.
    await page.evaluate(
      (ben) =>
        window.__presence.set(2, ben, {
          active: true,
          at: "https://site.test/",
          cursor: { selector: "body > h1", x: 0, y: 0 },
        }),
      BEN,
    )
    await cursor.waitFor()
    await people.click()
    assert.equal(await people.getAttribute("aria-pressed"), "false")
    assert.equal(await cursor.count(), 0)
    assert.equal(await page.evaluate(() => localStorage.getItem("drop-review-cursors")), "off")
    await people.click()
    await cursor.waitFor()

    // A cursor on another page of the site doesn't show here.
    await page.evaluate(
      (ben) =>
        window.__presence.set(2, ben, {
          active: true,
          at: "https://site.test/other",
          cursor: { selector: "body > h1", x: 0, y: 0 },
        }),
      BEN,
    )
    await page.waitForFunction(() => !document.querySelector("drop-review").shadowRoot.querySelector(".pc"))

    // Someone writes a comment, here or in Drop: the page's threads load at once.
    const before = seen.threads
    await page.evaluate(
      (ben) => window.__presence.set(2, ben, { active: true, at: "https://site.test/", comments: "a" }),
      BEN,
    )
    await page.waitForTimeout(100)
    const afterFirst = seen.threads
    await page.evaluate(
      (ben) => window.__presence.set(2, ben, { active: true, at: "https://site.test/", comments: "b" }),
      BEN,
    )
    for (let tries = 0; seen.threads === afterFirst && tries < 20; tries++) await page.waitForTimeout(50)
    assert.ok(seen.threads > afterFirst, "a new comment elsewhere loads this page's threads")
    assert.ok(afterFirst >= before)

    // Ben leaves: no faces.
    await page.evaluate(() => window.__presence.leave(2))
    await people.waitFor({ state: "hidden" })
    await context.close()
  } finally {
    await browser.close()
  }
})

test("a reviewer the review isn't shared with comments without presence, and never loads its client", async () => {
  const browser = await chromium.launch()
  try {
    const { context, page, seen, people } = await open(browser, { presence: false })
    await page.waitForTimeout(500)
    assert.equal(seen.tickets.length, 1)
    assert.equal(seen.client, 0)
    assert.equal(await people.isHidden(), true)
    assert.equal(await page.evaluate(() => window.__presence), undefined)
    await context.close()
  } finally {
    await browser.close()
  }
})
