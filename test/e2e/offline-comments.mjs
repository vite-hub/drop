import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { chromium } from "playwright"

// DROP_URL=http://127.0.0.1:3027 node test/e2e/offline-comments.mjs checks comments written with no network against a
// local Drop built for VPS and served with DROP_TEST_SIGNIN=true (email sign-up). The comment and reply POSTs are cut
// with Playwright routes, so the browser thinks it's online and the outbox must cope with failed requests, a lost
// answer, two tabs, refusals, a closed tab, a stale session and a guest who signs in. Step 10 holds the screenshots and
// POSTs instead, to check that Send closes the composer at once. Each step reports pass or fail and the run goes on;
// screenshots go to tmp/offline-check/. Exit 1 when any step failed.
const origin = new URL(process.env.DROP_URL ?? "http://127.0.0.1:3027")
assert.ok(
  ["127.0.0.1", "localhost"].includes(origin.hostname),
  "Run it against a local Drop: it signs up test accounts",
)
const shots = new URL("../../tmp/offline-check/", import.meta.url).pathname
await mkdir(shots, { recursive: true })
const password = "offline-check-password"
const email = (name) => `${name}-${crypto.randomUUID()}@example.test`
const WAIT = 90_000

const browser = await chromium.launch()
const results = []
// STEPS=6,7 runs only those steps, to look at one again. Steps 2 to 4 build on the ones before them.
const only = process.env.STEPS?.split(",").map((value) => value.trim())

/** Runs one step; a failed check fails the step and the run moves on. */
async function step(name, run) {
  if (only && !only.includes(name.split(".")[0].replace(/\D/g, ""))) return
  const failures = []
  const check = (ok, what) => {
    if (!ok) failures.push(what)
    return ok
  }
  try {
    await run(check)
  } catch (error) {
    const at =
      error instanceof Error
        ? [...(error.stack ?? "").matchAll(/offline-comments\.mjs:(\d+)/g)].map((m) => m[1]).join(" < ")
        : undefined
    failures.push(
      `threw${at ? ` at line ${at}` : ""}: ${error instanceof Error ? error.message.split("\n")[0] : error}`,
    )
  }
  results.push({ name, failures })
  console.log(`${failures.length ? "FAIL" : "PASS"} ${name}${failures.map((line) => `\n  - ${line}`).join("")}`)
}

async function api(context, path, body, method = body ? "POST" : "GET") {
  const response = await context.request.fetch(new URL(path, origin).href, {
    method,
    headers: { origin: origin.origin },
    ...(body ? { data: body } : {}),
  })
  const text = await response.text()
  if (!response.ok()) throw new Error(`${method} ${path} answered ${response.status()}: ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

async function publish(owner, title, share = true) {
  const markdown = `# ${title}\n\nFirst paragraph with some words to select for a text comment.\n\nSecond paragraph.\n\n## Part two\n\nMore text here.\n`
  const response = await owner.request.post(new URL("/api/files", origin).href, {
    headers: { origin: origin.origin },
    multipart: { file: { name: "plan.md", mimeType: "text/markdown", buffer: Buffer.from(markdown) } },
  })
  assert.equal(response.status(), 200, await response.text())
  const drop = await response.json()
  await api(owner, `/api/drops/${drop.id}`, { share: share ? "public_comment" : "private" }, "PATCH")
  return drop
}

/** What the server holds for a drop: threads, replies and images, by body. */
async function held(owner, drop) {
  const comments = await api(owner, `/api/drops/${drop.id}/comments`)
  const replies = comments.flatMap((comment) => comment.replies)
  return {
    comments,
    bodies: comments.map((comment) => comment.body),
    replies: replies.map((reply) => reply.body),
    images: [...comments, ...replies].reduce((sum, item) => sum + (item.attachments?.length ?? 0), 0),
  }
}

async function until(condition, timeout = WAIT, what = "condition") {
  const start = Date.now()
  for (;;) {
    const value = await condition()
    if (value) return value
    if (Date.now() - start > timeout) throw new Error(`timed out after ${timeout / 1000} s waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

// Accounts and drops. The owner publishes; the reviewer writes, in a context of their own (incognito: cookies of other
// Drop servers on this host don't leak in).
const owner = await browser.newContext()
await api(owner, "/api/auth/sign-up/email", { name: "Owner", email: email("owner"), password })
const drop = await publish(owner, "Offline plan")
const doomed = await publish(owner, "Soon in the Trash")
const reviewerEmail = email("reviewer")
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
})
const reviewer = await api(context, "/api/auth/sign-up/email", { name: "Reviewer", email: reviewerEmail, password })
const reviewerId = reviewer.user.id

// The network for comment and reply POSTs: "offline" aborts them, "lose" lets the next one reach the server and drops
// its answer, "refuse" answers the next one 400 with a sentence, "online" lets them through.
let network = "online"
// While `gate` is set, each comment POST waits for it before the switch above decides. Each of `refusals` answers the
// first POST whose body holds its text with its status, once.
let gate = null
const refusals = []
const sent = [] // { requestId, url, status } for each POST that left the page, status 0 when it got no answer
const commentPost = /\/api\/(drops\/[^/]+\/comments|comments\/[^/]+\/replies)(\?|$)/
const requestIdOf = (request) =>
  request
    .postDataBuffer()
    ?.toString("latin1")
    .match(/"requestId":"([^"]+)"/)?.[1]
// Every context's comment and reply POSTs go through the same switch: the reviewer's, and the guest's in step 8.
const cut = (target) => target.route(commentPost, through)
async function through(route) {
  const request = route.request()
  if (request.method() !== "POST") return route.fallback()
  const entry = { requestId: requestIdOf(request), url: request.url(), status: 0 }
  sent.push(entry)
  if (gate) {
    entry.held = true
    await gate
    entry.held = false
    // The page it came from has reloaded, and the browser cancelled it.
    if (entry.abandoned) return route.abort().catch(() => undefined)
  }
  const posted = request.postDataBuffer()?.toString("utf8") ?? ""
  const refusal = refusals.find((rule) => posted.includes(rule.text))
  if (refusal) {
    refusals.splice(refusals.indexOf(refusal), 1)
    entry.status = refusal.status
    return route
      .fulfill({
        status: refusal.status,
        contentType: "application/json",
        body: JSON.stringify({ statusCode: refusal.status, message: refusal.message, statusText: refusal.message }),
      })
      .catch(() => undefined)
  }
  if (network === "offline") return route.abort("internetdisconnected")
  if (network === "lose") {
    network = "offline"
    const response = await route.fetch()
    entry.status = response.status()
    entry.lost = true
    return route.abort("connectionreset")
  }
  if (network === "refuse") {
    network = "online"
    entry.status = 400
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        status: 400,
        statusCode: 400,
        statusText: "Keep it shorter.",
        message: "Keep it shorter.",
      }),
    })
  }
  // A POST held across a reload has no page left to answer.
  const response = await route.fetch().catch(() => null)
  if (!response) return route.abort().catch(() => undefined)
  entry.status = response.status()
  return route.fulfill({ response }).catch(() => undefined)
}
await cut(context)
const postsFor = (requestId) => sent.filter((entry) => entry.requestId === requestId)
const landedPosts = () => sent.filter((entry) => entry.status >= 200 && entry.status < 300 && !entry.lost)

// Viewer helpers.
async function open(page, target) {
  await page.goto(target.page)
  await page
    .getByRole("button", { name: /^Comments/ })
    .first()
    .waitFor()
  // Hydration, then the outbox learns who's signed in from /api/me.
  await page.waitForTimeout(2500)
}
const commentMode = (page) => page.getByRole("button", { name: /^Comments/ }).first()
async function startCommenting(page) {
  if ((await commentMode(page).getAttribute("aria-pressed")) !== "true") await commentMode(page).click()
}
async function stopCommenting(page) {
  if ((await commentMode(page).getAttribute("aria-pressed")) === "true") await commentMode(page).click()
}
const list = (page) => page.getByRole("list", { name: "Comments" })
async function showList(page) {
  const thread = page.getByRole("dialog", { name: "Comment thread" })
  if (await thread.isVisible()) {
    await thread.getByRole("button", { name: "Close" }).first().click()
    await page.waitForTimeout(400)
  }
  if (await list(page).isVisible()) return
  await startCommenting(page)
  const all = page.getByRole("button", { name: /^All comments/ })
  if ((await all.getAttribute("aria-expanded")) !== "true") await all.click()
  // An empty panel has no list, only "No open comments."
  await list(page).or(page.getByText("No open comments.")).first().waitFor()
}
const item = (page, body) => list(page).getByRole("listitem").filter({ hasText: body })
const newComment = (page) => page.getByRole("region", { name: "New comment" }).getByRole("textbox", { name: "Comment" })
async function frameBox(page) {
  const box = await page.locator("iframe").first().boundingBox()
  assert.ok(box, "the drop's frame is on the page")
  return box
}
/** The composer's automatic screenshot of the box, removed so the area carries the pasted image alone. */
async function removeShot(page) {
  const remove = page.getByRole("region", { name: "New comment" }).getByRole("button", { name: /^Remove screenshot/ })
  await remove.waitFor({ timeout: 15_000 }).then(
    () => remove.click(),
    () => undefined,
  )
}
async function pin(page, x, y, body) {
  await startCommenting(page)
  const box = await frameBox(page)
  await page.mouse.move(box.x + x, box.y + y)
  await page.mouse.down()
  await page.mouse.up()
  await newComment(page).waitFor()
  // The pin keeps the frame's screenshot of its box, which its row shows.
  await page
    .getByRole("region", { name: "New comment" })
    .getByRole("button", { name: /^Remove screenshot/ })
    .waitFor({ timeout: 15_000 })
  await newComment(page).fill(body)
  await newComment(page).press("Enter")
}
async function area(page, from, to, body) {
  await startCommenting(page)
  const box = await frameBox(page)
  await page.mouse.move(box.x + from[0], box.y + from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 4 })
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 })
  await page.mouse.up()
  await newComment(page).waitFor()
  await removeShot(page)
  // A pasted image, as from the clipboard.
  await newComment(page).evaluate(async (textarea) => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 16, height: 16 })
    const paint = canvas.getContext("2d")
    paint.fillStyle = "#e11d48"
    paint.fillRect(0, 0, 16, 16)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"))
    const data = new DataTransfer()
    data.items.add(new File([blob], "pasted.png", { type: "image/png" }))
    textarea.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
  })
  await page.getByRole("region", { name: "New comment" }).getByText("pasted.png").first().waitFor({ timeout: 5000 })
  await newComment(page).fill(body)
  await newComment(page).press("Enter")
}
async function selectText(page, words, body) {
  await stopCommenting(page)
  await page
    .frameLocator("iframe")
    .first()
    .locator("p", { hasText: words })
    .first()
    .evaluate((paragraph, words) => {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
      let text = walker.nextNode()
      while (text && !text.textContent.includes(words)) text = walker.nextNode()
      const start = text.textContent.indexOf(words)
      const range = document.createRange()
      range.setStart(text, start)
      range.setEnd(text, start + words.length)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
    }, words)
  await page.getByRole("button", { name: "Comment", exact: true }).first().click()
  await newComment(page).waitFor()
  await newComment(page).fill(body)
  await newComment(page).press("Enter")
}
async function pageComment(page, body) {
  await startCommenting(page)
  await page.getByRole("button", { name: "Whole page" }).click()
  const box = page.getByRole("textbox", { name: "Comment" }).last()
  await box.waitFor()
  await box.fill(body)
  await box.press("Enter")
  await page.waitForTimeout(300)
}
/** Opens a comment's thread: beside its pin, or in the dock for a comment on the whole page. */
async function openThread(page, body) {
  await showList(page)
  await item(page, body).getByRole("button").first().click()
  await page
    .getByRole("dialog", { name: "Comment thread" })
    .or(page.locator("[data-slot='comment-thread']"))
    .first()
    .waitFor()
}
async function reply(page, to, body) {
  await openThread(page, to)
  const box = page.getByRole("textbox", { name: "Reply" }).last()
  await box.waitFor()
  await box.fill(body)
  await box.press("Enter")
  await page.waitForTimeout(300)
}
/** The browser's copy of a waiting image (blob:) or the server's, in the row's thumbnail or the thread's pictures. */
const rowImage = (page, body) => item(page, body).locator("img[data-review-thumb]").first()
async function threadImage(page, body, name) {
  await openThread(page, body)
  const image = page.getByRole("dialog", { name: "Comment thread" }).locator(`img[alt="${name}"]`).first()
  const src = await image.getAttribute("src", { timeout: 5000 }).catch(() => null)
  await showList(page)
  return src
}
/** Whether an image's address works in the page: a revoked blob: URL doesn't load. */
const loads = (page, src) =>
  page.evaluate(
    (src) =>
      new Promise((resolve) => {
        const image = new Image()
        image.addEventListener("load", () => resolve(image.naturalWidth > 0))
        image.addEventListener("error", () => resolve(false))
        image.src = src
      }),
    src,
  )

/** Waiting or refused, as ViteHub's UI marks it (data-pending, data-failed) or Drop says it under the words. */
async function marked(page, body, state) {
  return page.evaluate(
    ({ body, state }) => {
      const attribute = state === "failed" ? "[data-failed='true']" : "[data-pending='true']"
      const documents = [
        document,
        ...[...document.querySelectorAll("iframe")].flatMap((frame) => {
          try {
            return frame.contentDocument ? [frame.contentDocument] : []
          } catch {
            return []
          }
        }),
      ]
      return documents.some((root) =>
        [...root.querySelectorAll(attribute)].some((element) => element.textContent?.includes(body)),
      )
    },
    { body, state },
  )
}
/** What the outbox keeps in IndexedDB: every record of the vitehub-comments database, with its Blobs measured. */
function saved(page) {
  return page.evaluate(async () => {
    const done = (request) =>
      new Promise((resolve, reject) => {
        request.addEventListener("success", () => resolve(request.result))
        request.addEventListener("error", () => reject(request.error))
      })
    const databases = (await indexedDB.databases()).filter((info) => info.name?.includes("comments"))
    const records = []
    for (const info of databases) {
      const db = await done(indexedDB.open(info.name))
      for (const name of db.objectStoreNames) {
        const all = await done(db.transaction(name).objectStore(name).getAll())
        for (const record of all) {
          const blobs = []
          const walk = (value, depth = 0) => {
            if (value instanceof Blob) blobs.push(value.size)
            else if (value && typeof value === "object" && depth < 6)
              for (const inner of Object.values(value)) walk(inner, depth + 1)
          }
          walk(record)
          records.push({ store: name, text: JSON.stringify(record).slice(0, 2000), blobs })
        }
      }
      db.close()
    }
    return records
  })
}
const entriesWith = async (page, body) => (await saved(page)).filter((record) => record.text.includes(body))
const shot = (page, name) => page.screenshot({ path: `${shots}${name}.png` })
/** Whether it shows within a few seconds: what follows a clock or an open thread isn't there the instant after. */
const appears = (locator, timeout = 5000) =>
  locator
    .first()
    .waitFor({ timeout })
    .then(
      () => true,
      () => false,
    )

const PIN = "Pin: the second paragraph needs a source"
const AREA = "Area: this part reads oddly"
const TEXT = "Text: some words could go"
const PAGE = "Page: good plan overall"
const REPLY = "Reply: and a link to it"
const four = [PIN, AREA, TEXT, PAGE]
const five = [...four, REPLY]

const page = await context.newPage()
const errors = []
page.on("pageerror", (error) => errors.push(error.message))
await open(page, drop)

await step("1. Offline write: five show at once as waiting, the dock says 5 waiting, no POST lands", async (check) => {
  network = "offline"
  await pin(page, 700, 237, PIN)
  await area(page, [380, 330], [560, 352], AREA)
  await selectText(page, "some words", TEXT)
  await pageComment(page, PAGE)
  await reply(page, PIN, REPLY)

  await showList(page)
  for (const body of four) check(await item(page, body).first().isVisible(), `"${body}" shows in the list`)
  for (const body of four) check(await marked(page, body, "pending"), `"${body}" is marked data-pending`)
  for (const body of four)
    check(!/^\s*0(?!\d)/.test((await item(page, body).first().textContent()) ?? ""), `"${body}" has no number 0`)
  await openThread(page, PIN)
  check(await page.getByText(REPLY).first().isVisible(), "the reply shows in its thread")
  check(await marked(page, REPLY, "pending"), "the reply is marked data-pending")
  check(
    !(await page
      .getByText(/^Comment 0$/)
      .first()
      .isVisible()
      .catch(() => false)),
    'the waiting thread isn\'t titled "Comment 0"',
  )
  await shot(page, "1-offline-thread")
  await showList(page)
  const thumb = await rowImage(page, PIN)
    .getAttribute("src", { timeout: 5000 })
    .catch(() => null)
  check(thumb?.startsWith("blob:"), `the waiting pin's row shows its screenshot from the browser (${thumb})`)
  const pasted = await threadImage(page, AREA, "pasted.png")
  check(pasted?.startsWith("blob:"), `the waiting area's thread shows the pasted image from the browser (${pasted})`)
  if (pasted) check(await loads(page, pasted), "the pasted image loads")
  check((await page.getByText("Waiting to send").count()) > 0, 'a "Waiting to send" line shows')
  // The dock counts one once its quiet start is over, which the reply's may not be yet.
  check(await appears(page.getByText(/\b5 waiting\b/)), 'the dock says "5 waiting"')
  check(landedPosts().length === 0, `no POST landed (${landedPosts().length} did)`)
  const server = await held(owner, drop)
  check(server.comments.length === 0, `the server holds no comment (${server.comments.length})`)
  await shot(page, "1-offline-write")
})

// The browser's addresses of the waiting images, revoked once they land.
const stale = []
await step("2. Reload: all five come back, the image too", async (check) => {
  await page.reload()
  await page
    .getByRole("button", { name: /^Comments/ })
    .first()
    .waitFor()
  await page.waitForTimeout(2500)
  await showList(page)
  for (const body of four)
    check(
      await item(page, body)
        .first()
        .isVisible()
        .catch(() => false),
      `"${body}" shows after reload`,
    )
  await openThread(page, PIN).catch(() => undefined)
  check(await appears(page.getByText(REPLY)), "the reply shows after reload")
  await showList(page)
  const areaEntry = await entriesWith(page, AREA)
  check(
    areaEntry.some((record) => record.blobs.some((size) => size > 0)),
    "the area's pasted image is still saved",
  )
  const thumb = await rowImage(page, PIN)
    .getAttribute("src", { timeout: 5000 })
    .catch(() => null)
  check(thumb?.startsWith("blob:"), `the pin's row still shows its screenshot (${thumb})`)
  const pasted = await threadImage(page, AREA, "pasted.png")
  check(Boolean(pasted?.startsWith("blob:") && (await loads(page, pasted))), "the area's thread still shows its image")
  stale.push(...[thumb, pasted].filter(Boolean))
  check(await appears(page.getByText(/\b5 waiting\b/)), 'the dock still says "5 waiting"')
  await shot(page, "2-reload")
})

await step(
  "3. Lost answer, then reconnect: four threads, one reply, two images; numbers replace the clocks",
  async (check) => {
    network = "lose"
    // The outbox retries on its own; the first try reaches the server and its answer is dropped.
    await until(() => sent.some((entry) => entry.lost), WAIT, "the first POST to reach the server")
    network = "online"
    const server = await until(
      async () => {
        const now = await held(owner, drop)
        return now.comments.length >= 4 && now.replies.length >= 1 ? now : null
      },
      WAIT,
      "four comments and a reply on the server",
    )
    await page.waitForTimeout(2000)
    check(server.comments.length === 4, `four threads (${server.comments.length}: ${server.bodies.join(" | ")})`)
    check(server.replies.length === 1, `one reply (${server.replies.length})`)
    check(server.images === 2, `two images, the pin's screenshot and the pasted one (${server.images})`)
    const thumb = await rowImage(page, PIN)
      .getAttribute("src", { timeout: 5000 })
      .catch(() => null)
    check(Boolean(thumb && !thumb.startsWith("blob:")), `the pin's row shows the server's screenshot (${thumb})`)
    const pasted = await threadImage(page, AREA, "pasted.png")
    check(Boolean(pasted && !pasted.startsWith("blob:")), `the area's thread shows the server's image (${pasted})`)
    for (const src of stale) check(!(await loads(page, src)), `the browser's address ${src} is revoked`)
    const lost = sent.find((entry) => entry.lost)
    check(postsFor(lost.requestId).length >= 2, "the comment whose answer was lost went out again")
    for (const body of five) check(!(await marked(page, body, "pending")), `"${body}" isn't marked waiting any more`)
    for (const body of [PIN, AREA, TEXT, PAGE]) {
      const label = await item(page, body)
        .getByRole("button")
        .first()
        .getAttribute("aria-label")
        .catch(() => null)
      const text =
        (await item(page, body)
          .first()
          .textContent()
          .catch(() => "")) ?? ""
      check(/^\s*[1-9]/.test(label ?? text), `"${body}" has its number in the list (${(label ?? text).slice(0, 12)})`)
    }
    await openThread(page, PIN)
    check((await page.getByText(REPLY).count()) === 1, "the reply shows once in its thread")
    await showList(page)
    const doubles = await Promise.all([PIN, AREA, TEXT, PAGE].map((body) => item(page, body).count()))
    check(
      doubles.every((count) => count === 1),
      `each comment shows once in the list (${doubles.join(", ")})`,
    )
    check(
      !(await page
        .getByText(/\b\d+ waiting\b/)
        .first()
        .isVisible()
        .catch(() => false)),
      "the dock count is gone",
    )
    check(
      (await saved(page)).filter((record) => five.some((body) => record.text.includes(body))).length === 0,
      "the outbox is empty",
    )
    await shot(page, "3-reconnected")
  },
)

await step("4. Two tabs on the same drop send one POST per requestId", async (check) => {
  network = "offline"
  const ONE = "Tab A: first of two"
  const TWO = "Tab A: second of two"
  await pageComment(page, ONE)
  await pageComment(page, TWO)
  const other = await context.newPage()
  await open(other, drop)
  await showList(other)
  check(
    await other
      .getByText(ONE)
      .first()
      .isVisible()
      .catch(() => false),
    "the second tab shows the waiting comment",
  )
  const ids = (await saved(page))
    .filter((record) => record.text.includes(ONE) || record.text.includes(TWO))
    .map((record) => record.text.match(/"requestId":"([^"]+)"/)?.[1])
    .filter(Boolean)
  check(ids.length === 2, `two saved entries (${ids.length})`)
  network = "online"
  await until(
    async () => {
      const now = await held(owner, drop)
      return now.bodies.includes(ONE) && now.bodies.includes(TWO)
    },
    WAIT,
    "both comments on the server",
  )
  await page.waitForTimeout(3000)
  for (const id of new Set(ids)) {
    const posts = postsFor(id).filter((entry) => entry.status > 0)
    check(posts.length === 1, `requestId ${id.slice(0, 8)} reached the server ${posts.length} times`)
  }
  const server = await held(owner, drop)
  check(server.bodies.filter((body) => body === ONE).length === 1, "the server holds the first one once")
  await showList(other)
  const listed = await until(() => item(other, ONE).count(), 10_000, "").catch(() => 0)
  check(listed === 1, `the second tab lists it once (${listed})`)
  await showList(page)
  const first = await until(() => item(page, ONE).count(), 10_000, "").catch(() => 0)
  check(first === 1, `the first tab lists it once (${first})`)
  await shot(page, "4-first-tab")
  await shot(other, "4-second-tab")
  await other.close()
})

await step("5a. Refused with 404 (drop trashed): the words stay, Copy and Discard work", async (check) => {
  const GONE = "Gone: written before the Trash"
  await open(page, doomed)
  network = "offline"
  await pageComment(page, GONE)
  await api(owner, `/api/drops/${doomed.id}`, { trashed: true }, "PATCH")
  network = "online"
  await until(() => sent.some((entry) => entry.url.includes(doomed.id) && entry.status === 404), WAIT, "the 404")
  await page.waitForTimeout(1500)
  check(
    await page
      .getByText(GONE)
      .first()
      .isVisible()
      .catch(() => false),
    "the words still show",
  )
  check(await marked(page, GONE, "failed"), "the comment is marked data-failed")
  check(
    await page
      .getByText(/no longer takes comments/)
      .first()
      .isVisible()
      .catch(() => false),
    "it says the drop no longer takes comments",
  )
  check((await entriesWith(page, GONE)).length > 0, "the outbox still keeps it")
  await shot(page, "5a-refused-404")
  // The row says it in a line; its thread has what the reader can do.
  await openThread(page, GONE)
  const copy = page.getByRole("button", { name: /^Copy$/ })
  if (
    check(
      await copy
        .first()
        .isVisible()
        .catch(() => false),
      "a Copy button shows",
    )
  ) {
    await copy.first().click()
    check(
      (await page.evaluate(() => navigator.clipboard.readText())).includes(GONE),
      "Copy puts the words on the clipboard",
    )
  }
  const discard = page.getByRole("button", { name: /^Discard$/ })
  if (
    check(
      await discard
        .first()
        .isVisible()
        .catch(() => false),
      "a Discard button shows",
    )
  ) {
    await discard.first().click()
    await page.waitForTimeout(800)
    check((await entriesWith(page, GONE)).length === 0, "Discard empties the outbox")
    check(
      !(await page
        .getByText(GONE)
        .first()
        .isVisible()
        .catch(() => false)),
      "Discard takes the words away",
    )
  }
  check(
    postsFor(sent.find((entry) => entry.url.includes(doomed.id))?.requestId).filter((e) => e.status === 404).length ===
      1,
    "it isn't resent after the 404",
  )
  await shot(page, "5a-after-discard")
})

await step("5b. Recover after leaving a drop that becomes unavailable", async (check) => {
  const revoked = await publish(owner, "Sharing will be revoked")
  const words = "Recover this from the app-wide outbox"
  const guest = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })
  try {
    await cut(guest)
    const tab = await guest.newPage()
    await open(tab, revoked)
    network = "offline"
    await pageComment(tab, words)
    await until(async () => (await entriesWith(tab, words)).length === 1, WAIT, "the durable entry")
    await tab.goto(new URL("/home", origin).href)
    await api(owner, `/api/drops/${revoked.id}`, { share: "private" }, "PATCH")
    network = "online"
    check((await tab.goto(revoked.page))?.status() === 404, "the original drop no longer opens")
    await tab.goto(new URL("/home", origin).href)
    await until(() => sent.some((entry) => entry.url.includes(revoked.id) && entry.status === 404), WAIT, "the 404")
    await tab.getByRole("button", { name: /^Unsent comments/ }).click()
    const recovery = tab.getByRole("dialog", { name: "Unsent comments" })
    await recovery.getByText("This drop no longer takes comments").waitFor()
    check(await recovery.getByText(words).isVisible(), "the draft is available without the drop viewer")
    await recovery.getByRole("button", { name: "Copy", exact: true }).click()
    check((await tab.evaluate(() => navigator.clipboard.readText())).includes(words), "recovery can copy the draft")
    await recovery.getByRole("button", { name: "Discard", exact: true }).click()
    await recovery.getByText("No unsent comments.").waitFor()
    check((await entriesWith(tab, words)).length === 0, "recovery removes the retained entry")
  } finally {
    network = "online"
    await guest.close()
  }
})

await step("5c. Refused with 400: Edit, resend, it lands", async (check) => {
  const BAD = "Bad: refused once"
  const FIXED = "Fixed: edited after the refusal"
  await open(page, drop)
  network = "refuse"
  await pageComment(page, BAD)
  await until(() => sent.some((entry) => entry.status === 400), WAIT, "the 400")
  await page.waitForTimeout(1500)
  await showList(page)
  check(await marked(page, BAD, "failed"), "the comment is marked data-failed")
  check(
    await page
      .getByText("Keep it shorter.")
      .first()
      .isVisible()
      .catch(() => false),
    "the server's sentence shows",
  )
  await shot(page, "5b-refused-400")
  await openThread(page, BAD)
  const edit = page.getByRole("button", { name: /^Edit$/ })
  if (
    check(
      await edit
        .first()
        .isVisible()
        .catch(() => false),
      "an Edit button shows",
    )
  ) {
    await edit.first().click()
    const box = page.getByRole("textbox", { name: "Edit the comment" })
    await box.fill(FIXED)
    await box.press("Enter")
    const resend = page.getByRole("button", { name: /^(Retry|Resend|Send)/ })
    // Enter sends it; the form's Send does the same where Enter didn't, and is gone once it did.
    await resend
      .first()
      .click({ timeout: 1000 })
      .catch(() => undefined)
    const landed = await until(
      async () => (await held(owner, drop)).bodies.includes(FIXED),
      30_000,
      "the edited comment",
    ).catch(() => false)
    check(landed, "the edited comment lands")
  }
  check(!(await held(owner, drop)).bodies.includes(BAD), "the refused words never landed")
  await shot(page, "5b-after-edit")
})

await step("6. Closing the tab warns while one waits, not when empty; sign-out asks first", async (check) => {
  const CLOSE = "Close: written before the tab closed"
  const tab = await context.newPage()
  await open(tab, drop)
  network = "offline"
  await pageComment(tab, CLOSE)
  let dialogs = 0
  tab.on("dialog", (dialog) => {
    if (dialog.type() === "beforeunload") dialogs++
    void dialog.dismiss()
  })
  await tab.close({ runBeforeUnload: true })
  await tab.waitForTimeout(1500)
  check(dialogs === 1 && !tab.isClosed(), `closing with one waiting asks first (${dialogs} dialogs)`)

  // Sign-out with one waiting asks first, from the dashboard's account menu: the app's outbox outlives the drop page.
  await tab.getByRole("link", { name: "Drop" }).first().click()
  await tab.waitForURL((url) => !url.pathname.startsWith("/d/"))
  await tab.waitForTimeout(1500)

  await tab.getByRole("button", { name: "Account menu" }).click()
  await tab.getByRole("menuitem", { name: "Sign out" }).click()
  const confirm = tab.getByRole("dialog").filter({ hasText: /isn't sent|aren't sent/ })
  const asked = await confirm
    .first()
    .waitFor({ timeout: 5000 })
    .then(
      () => true,
      () => false,
    )
  check(asked, "sign-out asks before discarding the waiting comment")
  await shot(tab, "6-sign-out-asks")
  if (asked) await confirm.first().getByRole("button", { name: "Cancel" }).click()
  check((await api(context, "/api/me"))?.id === reviewerId, "Cancel keeps the reviewer signed in")
  check((await entriesWith(tab, CLOSE)).length > 0, "Cancel keeps the comment saved")

  network = "online"
  await until(async () => (await held(owner, drop)).bodies.includes(CLOSE), WAIT, "the waiting comment to land")
  await until(async () => (await entriesWith(tab, CLOSE)).length === 0, 10_000, "the outbox to empty").catch(
    () => undefined,
  )
  const left = (await saved(tab)).length
  dialogs = 0
  await tab.close({ runBeforeUnload: true })
  await tab.waitForEvent("close", { timeout: 5000 }).catch(() => undefined)
  check(
    dialogs === 0 && tab.isClosed(),
    `closing with nothing waiting doesn't ask (${dialogs} dialogs, ${left} entries saved)`,
  )
})

await step(
  "7. Stale session: signed out in another tab, the send is held as Sign in to send, then goes as the same person",
  async (check) => {
    const STALE = "Stale: written after signing out elsewhere"
    await open(page, drop)
    network = "online"
    const elsewhere = await context.newPage()
    await elsewhere.goto(new URL("/home", origin).href)
    await elsewhere.evaluate(() =>
      fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    )
    await elsewhere.close()
    await pageComment(page, STALE)
    await until(() => sent.some((entry) => entry.status === 401), 30_000, "the 401")
    await page.waitForTimeout(2000)
    check(!(await held(owner, drop)).bodies.includes(STALE), "the server stored nothing")
    await page.getByRole("button", { name: /^Unsent comments/ }).click()
    const recovery = page.getByRole("dialog", { name: "Unsent comments" })
    check((await recovery.getByText(STALE).count()) === 0, "the words are hidden while signed out")
    check(
      await recovery
        .getByText(/Sign in to send/)
        .first()
        .isVisible()
        .catch(() => false),
      'it says "Sign in to send"',
    )
    check(
      (await entriesWith(page, STALE)).some((record) => record.text.includes(reviewerId)),
      "the outbox keeps it as the reviewer's",
    )
    await shot(page, "7-held-signed-out")
    await api(context, "/api/auth/sign-in/email", { email: reviewerEmail, password })
    // Back from signing in, as the sign-in page returns to the drop.
    await page.reload()
    const server = await until(
      async () => {
        const now = await held(owner, drop)
        return now.comments.find((comment) => comment.body === STALE)
      },
      WAIT,
      "the held comment to land",
    ).catch(() => undefined)
    check(Boolean(server), "it sends once the same person is signed in")
    check(server?.authorName === "Reviewer", `it's the reviewer's (${server?.authorName})`)
    await page.waitForTimeout(1500)
    await shot(page, "7-sent-after-sign-in")
  },
)

await step("9. Private queued text and image are hidden after session expiry and a fresh visit", async (check) => {
  const author = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const address = email("private-author")
  try {
    await api(author, "/api/auth/sign-up/email", { name: "Private author", email: address, password })
    const privateDrop = await publish(author, "Only me", false)
    const words = "Private offline comment with an image"
    await cut(author)
    const tab = await author.newPage()
    await open(tab, privateDrop)
    network = "offline"
    await area(tab, [70, 70], [240, 160], words)
    await until(async () => (await entriesWith(tab, words)).length === 1, WAIT, "the durable private entry")
    await api(author, "/api/auth/sign-out", {})
    await tab.goto(new URL("/home", origin).href)
    await tab.getByRole("button", { name: "Unsent comments (1)" }).click()
    const recovery = tab.getByRole("dialog", { name: "Unsent comments" })
    await recovery.getByRole("link", { name: "Sign in to send" }).waitFor()
    check((await recovery.getByText(words).count()) === 0, "signed-out recovery doesn't render the draft text")
    check((await recovery.getByRole("button", { name: "Copy" }).count()) === 0, "there is no copy action")
    check((await recovery.locator("a[download]").count()) === 0, "there is no attachment download")
    await recovery.getByRole("link", { name: "Sign in to send" }).click()
    await tab.waitForURL((url) => url.pathname === "/signin")
    await recovery.waitFor({ state: "hidden" })
    await tab.getByRole("button", { name: "Sign in with GitHub" }).click({ trial: true })
    await api(author, "/api/auth/sign-in/email", { email: address, password })
    await tab.goto(new URL("/home", origin).href)
    await tab.getByRole("button", { name: "Unsent comments (1)" }).click()
    await recovery.getByText(words).waitFor()
    check((await recovery.locator("a[download]").count()) === 1, "the author can recover their attachment")
  } finally {
    network = "online"
    await author.close()
  }
})

await step("8. A guest writes offline, then signs in: it lands once, as them", async (check) => {
  const GUEST = "Guest: written before signing in"
  const guest = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await cut(guest)
  const tab = await guest.newPage()
  await open(tab, drop)
  network = "offline"
  await pageComment(tab, GUEST)
  await showList(tab)
  check(
    await item(tab, GUEST)
      .first()
      .isVisible()
      .catch(() => false),
    "the guest's comment shows",
  )
  check(await marked(tab, GUEST, "pending"), "it's marked data-pending")
  const [kept] = await entriesWith(tab, GUEST)
  const requestId = kept?.text.match(/"requestId":"([^"]+)"/)?.[1]
  check(Boolean(kept?.text.includes('"account":"guest"')), "the outbox keeps it as the guest's")
  await shot(tab, "8-guest-offline")

  // The guest signs up and comes back to the drop, as the sign-in page returns them; the network is back once they're
  // there. Back any earlier, the page they leave may send it as the reload starts, and its answer comes too late for
  // that page: the server then answers the new page's send with the same comment, which is right but counts two POSTs.
  const name = "Former guest"
  const account = await api(guest, "/api/auth/sign-up/email", { name, email: email("guest"), password })
  await tab.reload()
  network = "online"
  const landed = await until(
    async () => (await held(owner, drop)).comments.find((comment) => comment.body === GUEST),
    WAIT,
    "the guest's comment to land",
  ).catch(() => undefined)
  check(Boolean(landed), "it lands once they're signed in, with no prompt")
  check(landed?.authorName === name, `it's theirs (${landed?.authorName})`)
  check(landed?.authorId === account.user.id, "under their account")
  await tab.waitForTimeout(2000)
  const server = await held(owner, drop)
  check(server.bodies.filter((body) => body === GUEST).length === 1, "the server holds it once")
  const answered = postsFor(requestId).filter((entry) => entry.status >= 200 && entry.status < 300)
  check(answered.length === 1, `one POST of it landed (${answered.length})`)
  check((await entriesWith(tab, GUEST)).length === 0, "the outbox is empty")
  await showList(tab)
  check((await item(tab, GUEST).count()) === 1, "it shows once")
  check(!(await marked(tab, GUEST, "pending")), "it isn't marked waiting any more")
  await shot(tab, "8-guest-signed-in")
  await guest.close()
})

// The viewer's frame posts each area's screenshot ("area-shot") when it has rendered it. With `__holdShots` on, the
// viewer doesn't hear them until `__releaseShots()` replays them, as from a slow capture.
function holdShots() {
  const held = []
  window.__holdShots = false
  window.__heldShots = () => held.length
  // How long each capture took, from its area to its screenshot, held or not.
  const drawn = new Map()
  window.__captureMs = []
  addEventListener(
    "message",
    (event) => {
      if (event.isTrusted && event.data?.type === "area") drawn.set(event.data.shot, performance.now())
      if (event.isTrusted && event.data?.type === "area-shot" && drawn.has(event.data.shot))
        window.__captureMs.push(Math.round(performance.now() - drawn.get(event.data.shot)))
      if (!window.__holdShots || !event.isTrusted || event.data?.type !== "area-shot") return
      event.stopImmediatePropagation()
      held.push(event)
    },
    { capture: true },
  )
  window.__releaseShots = () => {
    window.__holdShots = false
    for (const event of held.splice(0))
      dispatchEvent(new MessageEvent("message", { data: event.data, origin: event.origin, source: event.source }))
  }
}
/** Draws an area on the frame and waits for its composer. */
async function drawArea(page, from, to) {
  await startCommenting(page)
  const box = await frameBox(page)
  await page.mouse.move(box.x + from[0], box.y + from[1])
  await page.mouse.down()
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 })
  await page.mouse.up()
  await newComment(page)
    .waitFor({ timeout: 5000 })
    .catch(async (error) => {
      await shot(page, `no-composer-${from.join("-")}`)
      throw error
    })
}
/** Types and presses Enter; answers how many ms the composer stayed after the keypress, or Infinity past 3 s. */
async function sendTimed(page, body) {
  await newComment(page).fill(body)
  await page.evaluate(() => {
    window.__closed = new Promise((resolve) => {
      let start
      const keydown = (event) => event.key === "Enter" && start === undefined && (start = performance.now())
      addEventListener("keydown", keydown, true)
      const finish = (ms) => {
        observer.disconnect()
        removeEventListener("keydown", keydown, true)
        resolve(ms)
      }
      const observer = new MutationObserver(() => {
        if (start !== undefined && !document.querySelector("[data-pin-composer]")) finish(performance.now() - start)
      })
      observer.observe(document.body, { childList: true, subtree: true })
      setTimeout(() => finish(Infinity), 3000)
    })
  })
  await newComment(page).press("Enter")
  return page.evaluate(() => window.__closed)
}
/** The open composer's screenshot, folded away under "Show 1 picture" or not. */
const composerShot = (page) => page.locator('[data-pin-composer] [aria-label^="Remove screenshot"]')
const pendingPins = (page) => page.frameLocator("iframe").first().locator('[data-delivery="pending"]:not(small)')
const failedPins = (page) => page.frameLocator("iframe").first().locator('[data-delivery="failed"]:not(small)')
/** Records every "N waiting" or "Unsent comments" the page shows from now until `stop()`. */
async function watchTrouble(page) {
  await page.evaluate(() => {
    window.__trouble = new Set()
    const look = () => {
      for (const element of document.querySelectorAll("[data-waiting], button"))
        if (element.matches("[data-waiting]") || element.textContent.trim().startsWith("Unsent comments"))
          window.__trouble.add(element.textContent.trim())
    }
    window.__troubleWatch = new MutationObserver(look)
    window.__troubleWatch.observe(document.body, { childList: true, subtree: true, characterData: true })
    look()
  })
  return {
    stop: () =>
      page.evaluate(() => {
        window.__troubleWatch.disconnect()
        return [...window.__trouble]
      }),
  }
}
const bytes = async (target, url) => {
  const response = await target.request.get(new URL(url, origin).href)
  return response.ok()
    ? createHash("sha256")
        .update(await response.body())
        .digest("hex")
    : `HTTP ${response.status()}`
}

await step(
  "10. Instant Send: each composer closes at once while the screenshot and POST are held; three land in order with their own screenshots; a refusal keeps its words; a reload keeps one held",
  async (check) => {
    const target = await publish(owner, "Instant comments")
    // A reviewer of its own, so what earlier steps left in the outbox doesn't sit in front of these.
    const reviewing = await browser.newContext({ viewport: { width: 1400, height: 900 } })
    await api(reviewing, "/api/auth/sign-up/email", { name: "Quick reviewer", email: email("quick"), password })
    await cut(reviewing)
    network = "online"
    const tab = await reviewing.newPage()
    tab.on("pageerror", (error) => errors.push(error.message))
    await tab.addInitScript(holdShots)
    await open(tab, target)
    // A first comment loads the screenshot module and settles the outbox, as a reviewer's first one does.
    const WARM = "Instant: warm-up"
    await drawArea(tab, [380, 150], [560, 172])
    await composerShot(tab).waitFor({ state: "attached", timeout: 15_000 })
    await newComment(tab).fill(WARM)
    await newComment(tab).press("Enter")
    await until(async () => (await held(owner, target)).bodies.includes(WARM), 30_000, "the warm-up comment")

    // 1-4. Screenshots and POSTs held; three comments in a burst.
    const burst = ["Instant: first of three", "Instant: second of three", "Instant: third of three"]
    const spots = [
      [
        [380, 215],
        [600, 237],
      ],
      [
        [380, 300],
        [600, 322],
      ],
      [
        [380, 380],
        [600, 400],
      ],
    ]
    const trouble = await watchTrouble(tab)
    let release
    gate = new Promise((resolve) => (release = resolve))
    await tab.evaluate(() => (window.__holdShots = true))
    const started = Date.now()
    const before = await pendingPins(tab).count()
    let firstSent
    for (const [index, body] of burst.entries()) {
      await drawArea(tab, ...spots[index])
      const leftover = await newComment(tab).inputValue()
      check(leftover === "", `composer ${index + 1} starts empty (${JSON.stringify(leftover)})`)
      check((await composerShot(tab).count()) === 0, `composer ${index + 1} has no screenshot left from the one before`)
      const ms = await sendTimed(tab, body)
      firstSent ??= Date.now()
      check(ms <= 150, `composer ${index + 1} is gone ${Math.round(ms)} ms after Enter (at most 150)`)
      const shown = await until(
        async () => (await pendingPins(tab).count()) >= before + index + 1,
        1000,
        "the pending pin",
      ).catch(() => false)
      check(shown, `comment ${index + 1} shows as a pending pin (${await pendingPins(tab).count()} pending)`)
    }
    // Held as long as a heavy page's capture takes (up to 2.5 s): the first comment's screenshot still joins it.
    await tab.waitForTimeout(Math.max(0, firstSent + 2500 - Date.now()))
    const heldShots = await tab.evaluate(() => window.__heldShots())
    check(heldShots >= 1, `the screenshots were still held when the burst ended (${heldShots})`)
    console.log(`  burst written and held for ${Date.now() - started} ms, ${heldShots} screenshots held`)
    await tab.evaluate(() => window.__releaseShots())
    release()
    gate = null

    // 5. All three land, in order, each with a screenshot of its own.
    const landed = await until(
      async () => {
        const now = await held(owner, target)
        return burst.every((body) => now.bodies.includes(body)) ? now : null
      },
      30_000,
      "the three comments on the server",
    ).catch(() => null)
    const flagged = await trouble.stop()
    check(
      Date.now() - started > 5000 || flagged.length === 0,
      `no trouble chip during the burst (${flagged.join(", ")})`,
    )
    console.log(`  burst landed ${Date.now() - started} ms after it started`)
    if (check(Boolean(landed), "all three land")) {
      const three = landed.comments.filter((comment) => burst.includes(comment.body)).sort((a, b) => a.n - b.n)
      check(
        three.map((comment) => comment.body).join() === burst.join(),
        `they land in order (${three.map((c) => `${c.n} ${c.body}`).join(", ")})`,
      )
      check(
        burst.every((body) => landed.bodies.filter((each) => each === body).length === 1),
        "each lands once",
      )
      const attached = three.map((comment) => comment.attachments ?? [])
      check(
        attached.every((files) => files.length === 1 && files[0].contentType.startsWith("image/")),
        `each has one screenshot (${attached.map((files) => files.length).join(", ")})`,
      )
      const hashes = await Promise.all(attached.flat().map((file) => bytes(owner, file.url)))
      check(
        new Set(hashes).size === hashes.length,
        `no two share a screenshot (${hashes.map((h) => h.slice(0, 8)).join(", ")})`,
      )
    }
    await shot(tab, "10-burst-landed")

    // 6. One POST answered 422 and the next 500: the refused one shows failed and keeps its words, the next isn't
    // stuck behind it and goes again by itself.
    const REFUSED = "Instant: refused once"
    const AFTER = "Instant: answered 500 once"
    refusals.push(
      { text: REFUSED, status: 422, message: "Say which part." },
      { text: AFTER, status: 500, message: "Server error" },
    )
    await drawArea(tab, [640, 140], [820, 160])
    await sendTimed(tab, REFUSED)
    await drawArea(tab, [640, 215], [820, 235])
    await sendTimed(tab, AFTER)
    await until(async () => (await held(owner, target)).bodies.includes(AFTER), 30_000, "the comment after it").catch(
      () => undefined,
    )
    const afterServer = await held(owner, target)
    console.log(`  captures took ${(await tab.evaluate(() => window.__captureMs)).join(", ")} ms`)
    check(afterServer.bodies.filter((body) => body === AFTER).length === 1, "the 500 one goes again and lands once")
    check(
      await appears(failedPins(tab)),
      `the refused comment's pin shows failed (${await failedPins(tab).count()} failed)`,
    )
    await showList(tab)
    check(await marked(tab, REFUSED, "failed"), "the refused comment is marked data-failed with its words")
    await shot(tab, "10-refused")
    await openThread(tab, REFUSED)
    const again = tab.getByRole("button", { name: /^(Retry|Edit)$/ })
    if (check(await appears(again), "the refused comment offers Retry or Edit")) {
      console.log(`  the refused comment offers ${await again.first().textContent()}`)
      await again.first().click()
      const box = tab.getByRole("textbox", { name: "Edit the comment" })
      if (await appears(box, 1000)) {
        check((await box.inputValue()) === REFUSED, "Edit starts from the refused words")
        await box.press("Enter")
      }
      const resent = await until(
        async () => (await held(owner, target)).bodies.includes(REFUSED),
        30_000,
        "the resent comment",
      ).catch(() => false)
      check(resent, "sending it again lands it")
    }

    // 7. A reload with one POST held and the next one's screenshot held: both come back, and each lands once.
    const RELOAD = "Instant: POST held across a reload"
    const UNSHOT = "Instant: screenshot held across a reload"
    gate = new Promise((resolve) => (release = resolve))
    await tab.keyboard.press("Escape")
    await drawArea(tab, [640, 290], [820, 310])
    await sendTimed(tab, RELOAD)
    const requestId = await until(
      async () => (await entriesWith(tab, RELOAD))[0]?.text.match(/"requestId":"([^"]+)"/)?.[1],
      5000,
      "the saved entry",
    ).catch(() => undefined)
    check(Boolean(requestId), "the outbox keeps it")
    const atGate = await until(() => postsFor(requestId).some((entry) => entry.held), 10_000, "the held POST").catch(
      () => false,
    )
    check(atGate, "its POST is out and held")
    await tab.evaluate(() => (window.__holdShots = true))
    await drawArea(tab, [640, 335], [820, 352])
    await sendTimed(tab, UNSHOT)
    check((await entriesWith(tab, UNSHOT)).length === 1, "the outbox keeps the one waiting for its screenshot")
    for (const entry of sent) if (entry.held) entry.abandoned = true
    await tab.reload()
    const kept = await until(async () => (await pendingPins(tab).count()) >= 2, 15_000, "two pending pins").catch(
      () => false,
    )
    check(kept, `after the reload both show as pending pins (${await pendingPins(tab).count()})`)
    release()
    gate = null
    const back = await until(
      async () => {
        const now = await held(owner, target)
        return now.bodies.includes(RELOAD) && now.bodies.includes(UNSHOT)
      },
      30_000,
      "both comments after the reload",
    ).catch(() => false)
    check(back, "both land after the reload")
    await tab.waitForTimeout(1500)
    const server = await held(owner, target)
    for (const body of [RELOAD, UNSHOT])
      check(server.bodies.filter((each) => each === body).length === 1, `the server holds "${body}" once`)
    const answered = postsFor(requestId).filter((entry) => entry.status >= 200 && entry.status < 300)
    check(answered.length === 1, `one POST of the held one landed (${answered.length})`)
    console.log(
      `  after the reload: ${server.comments
        .filter((c) => [RELOAD, UNSHOT].includes(c.body))
        .map((c) => `"${c.body}" with ${c.attachments?.length ?? 0} attachment(s)`)
        .join(", ")}`,
    )
    await shot(tab, "10-after-reload")
    await reviewing.close()
  },
)

if (errors.length) console.log(`Page errors:\n${[...new Set(errors)].map((line) => `  ${line}`).join("\n")}`)
await browser.close()
const failed = results.filter((result) => result.failures.length)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Screenshots in ${shots}`)
process.exit(failed.length ? 1 : 0)
