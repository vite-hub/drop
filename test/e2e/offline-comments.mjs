import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { chromium } from "playwright"

// DROP_URL=http://127.0.0.1:3027 node test/e2e/offline-comments.mjs checks comments written with no network against a
// local Drop built for VPS and served with DROP_TEST_SIGNIN=true (email sign-up). The comment and reply POSTs are cut
// with Playwright routes, so the browser thinks it's online and the outbox must cope with failed requests, a lost
// answer, two tabs, refusals, a closed tab, a stale session and a guest who signs in. Each step reports pass or fail and the run goes on;
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
    const at = error instanceof Error ? error.stack?.match(/offline-comments\.mjs:(\d+)/)?.[1] : undefined
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

async function publish(owner, title) {
  const markdown = `# ${title}\n\nFirst paragraph with some words to select for a text comment.\n\nSecond paragraph.\n\n## Part two\n\nMore text here.\n`
  const response = await owner.request.post(new URL("/api/files", origin).href, {
    headers: { origin: origin.origin },
    multipart: { file: { name: "plan.md", mimeType: "text/markdown", buffer: Buffer.from(markdown) } },
  })
  assert.equal(response.status(), 200, await response.text())
  const drop = await response.json()
  await api(owner, `/api/drops/${drop.id}`, { share: "public_comment" }, "PATCH")
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
  const response = await route.fetch()
  entry.status = response.status()
  return route.fulfill({ response })
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
async function openThread(page, body) {
  await showList(page)
  await item(page, body).getByRole("button").first().click()
  await page.getByRole("dialog", { name: "Comment thread" }).waitFor()
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
  check(
    await page
      .getByText(/\b5 waiting\b/)
      .first()
      .isVisible()
      .catch(() => false),
    'the dock says "5 waiting"',
  )
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
  check(
    await page
      .getByText(REPLY)
      .first()
      .isVisible()
      .catch(() => false),
    "the reply shows after reload",
  )
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
  check(
    await page
      .getByText(/\b5 waiting\b/)
      .first()
      .isVisible()
      .catch(() => false),
    'the dock still says "5 waiting"',
  )
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

await step("5b. Refused with 400: Edit, resend, it lands", async (check) => {
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
    if (
      await resend
        .first()
        .isVisible()
        .catch(() => false)
    )
      await resend.first().click()
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
    await showList(page).catch(() => undefined)
    check(
      await item(page, STALE)
        .first()
        .isVisible()
        .catch(() => false),
      "the words still show in the list",
    )
    check(
      await page
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

  // The guest signs up and comes back to the drop, as the sign-in page returns them; the network is back meanwhile.
  const name = "Former guest"
  const account = await api(guest, "/api/auth/sign-up/email", { name, email: email("guest"), password })
  network = "online"
  await tab.reload()
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

if (errors.length) console.log(`Page errors:\n${[...new Set(errors)].map((line) => `  ${line}`).join("\n")}`)
await browser.close()
const failed = results.filter((result) => result.failures.length)
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed. Screenshots in ${shots}`)
process.exit(failed.length ? 1 : 0)
