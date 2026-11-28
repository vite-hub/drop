import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { ACME, BLOCK, DROP, REVIEW, startDrop } from "./drop.mjs"
import { PROXY, SITES, startServer } from "./server.mjs"
import { report, step } from "./util.mjs"

const extension = fileURLToPath(new URL("../.output-e2e/chrome-mv3", import.meta.url))
const headless = process.env.DROP_E2E_HEADED !== "1"
const out = { browser: "chromium", checks: {} }

const { fake, local } = await startDrop()
const server = await startServer(local)
const tunnels = []
server.on("connect", (req) => tunnels.push(req.url))
const profile = mkdtempSync(join(tmpdir(), "drop-e2e-pill-"))
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless,
  viewport: null,
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "--enable-unsafe-extension-debugging",
    `--proxy-server=http://${PROXY}`,
    "--window-size=1000,700",
    "--force-device-scale-factor=2",
  ],
})

async function compose(page, words) {
  const ui = page.locator("drop-review")
  await ui.getByRole("button", { name: "Comment", exact: true }).click()
  await ui.locator(".draw:not([hidden])").waitFor()
  await page.mouse.click(BLOCK.left + BLOCK.width / 2, BLOCK.top + BLOCK.height / 2)
  await ui.getByRole("textbox", { name: "Comment" }).fill(words)
}

async function compareShots([taken, screen, block]) {
  const [a, b] = await Promise.all(
    [
      [taken, "image/webp"],
      [screen, "image/png"],
    ].map(([base64, type]) =>
      createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type })),
    ),
  )
  const size = { shot: [a.width, a.height], page: [b.width, b.height], viewport: [innerWidth, innerHeight] }
  if (a.width !== b.width || a.height !== b.height) return { size }
  const [pa, pb] = [a, b].map((image) => {
    const canvas = new OffscreenCanvas(image.width, image.height)
    const drawn = canvas.getContext("2d")
    drawn.drawImage(image, 0, 0)
    return drawn.getImageData(0, 0, image.width, image.height).data
  })
  let total = 0
  let worst = 0
  for (let i = 0; i < pa.length; i += 4)
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(pa[i + c] - pb[i + c])
      total += d
      worst = Math.max(worst, d)
    }
  const k = a.width / innerWidth
  const at = (x, y) => {
    const i = (Math.round(y * k) * a.width + Math.round(x * k)) * 4
    return Array.from(pa.slice(i, i + 3))
  }
  return {
    size,
    mean: total / ((pa.length / 4) * 3),
    worst,
    block: at(block.left + block.width / 2, block.top + block.height / 2),
    pill: at(innerWidth / 2, innerHeight - 30),
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, what, ms = 10_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await wait(100)
  }
  throw new Error(`waited for ${what}`)
}

try {
  out.version = context.browser()?.version()
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const id = new URL(worker.url()).host
  const welcome = `chrome-extension://${id}/welcome.html`
  const extensionPage = await until(() => context.pages().find((p) => p.url() === welcome), "the welcome tab")

  async function background(type, payload = {}) {
    const reply = await extensionPage.evaluate(
      ([kind, fields]) => chrome.runtime.sendMessage({ ...fields, type: kind }),
      [type, payload],
    )
    if (!reply?.ok) throw new Error(`${type}: ${reply?.error}`)
    return reply.value
  }

  async function press(page) {
    await page.bringToFront()
    const session = await context.browser().newBrowserCDPSession()
    const { targetInfos } = await session.send("Target.getTargets", { filter: [{ type: "tab" }] })
    const target = targetInfos.find((t) => t.url === page.url())
    await session.send("Extensions.triggerAction", { id, targetId: target.targetId })
    await session.detach()
  }

  const sent = (dropId) => fake.threads.get(dropId) ?? []

  out.checks.freshInstall = await step(
    "a fresh install puts nothing on five sites and asks no Drop anything",
    async () => {
      const found = []
      for (const url of SITES) {
        const page = await context.newPage()
        await page.goto(url)
        await page.waitForTimeout(1000)
        found.push({ url, hosts: await page.locator("drop-review").count() })
        await page.close()
      }
      if (found.some((h) => h.hosts !== 0)) throw new Error(`injected: ${JSON.stringify(found)}`)
      if (fake.requests.length || tunnels.length)
        throw new Error(`requests: ${JSON.stringify([...fake.requests.map((r) => r.url), ...tunnels])}`)
      return found
    },
    30_000,
  )

  out.storageAccess = await worker.evaluate(async () => {
    const answers = {}
    for (const [name, area] of [
      ["local", chrome.storage.local],
      ["session", chrome.storage.session],
    ]) {
      if (typeof area.setAccessLevel !== "function") answers[name] = "missing"
      else
        answers[name] = await area.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).then(
          () => "ok",
          (error) => error.message,
        )
    }
    return answers
  })

  out.checks.link = await step("the extension links to the Drop through OAuth", async () => {
    await background("deployment.set", { drop: DROP })
    const linked = await background("link.start")
    if (!linked.ok) throw new Error(`not linked: ${linked.problem} ${linked.detail}`)
    const { state } = linked
    if (!state.account) throw new Error("not linked")
    return state.account
  })

  out.checks.handIndexGate = await step(
    "with the hand on, five note-less sites ask nothing, and a site with a review gets the pill",
    async () => {
      await background("hand.set", { hand: "everywhere" })
      await until(() => fake.counts.index > 0, "the index")
      await wait(300)
      const before = fake.requests.length
      const found = []
      for (const url of SITES) {
        const page = await context.newPage()
        await page.goto(url)
        await page.waitForTimeout(1000)
        found.push({ url, hosts: await page.locator("drop-review").count() })
        await page.close()
      }
      const asked = fake.requests.slice(before).map((r) => `${r.method} ${new URL(r.url).pathname}`)
      if (found.some((h) => h.hosts !== 0) || asked.length)
        throw new Error(`injected ${JSON.stringify(found)}, asked ${JSON.stringify(asked)}`)
      const acme = await context.newPage()
      await acme.goto(`${ACME}/hand`)
      await acme.locator("drop-review").getByRole("button", { name: "Comment", exact: true }).waitFor()
      await acme.close()
      await worker.evaluate(() => chrome.storage.local.set({ hand: "press" }))
      return { sites: found, index: fake.counts.index }
    },
    40_000,
  )

  const page = await context.newPage()
  await page.goto(`${ACME}/pricing`)
  const ui = page.locator("drop-review")

  out.checks.comment = await step(
    "a pressed pill sends a comment to the review only on a real click, with a pixel-exact screenshot",
    async () => {
      await press(page)
      await ui.getByRole("button", { name: "Comment", exact: true }).waitFor()
      await page.bringToFront()
      await page.evaluate(() => document.querySelector("drop-review").style.setProperty("opacity", "0", "important"))
      await page.waitForTimeout(200)
      const reference = (await page.screenshot()).toString("base64")
      await page.evaluate(() => document.querySelector("drop-review").style.removeProperty("opacity"))

      await compose(page, "Bigger block")
      await page.evaluate(() => {
        const root = document.querySelector("drop-review").shadowRoot
        root.querySelector(".pop [type=submit]").click()
        root.querySelector(".pop").requestSubmit()
      })
      await page.waitForTimeout(500)
      if (sent(REVIEW.id).length) throw new Error("a script's click sent the comment")
      if (fake.shots.size) throw new Error("a screenshot reached the Drop before Send")

      await ui.getByRole("button", { name: "Send" }).click()
      await ui.getByText("Sent as #1.").waitFor()
      const [thread] = sent(REVIEW.id)
      if (thread?.body !== "Bigger block" || !thread.screenshot) throw new Error(JSON.stringify(thread))
      const shot = Buffer.from(fake.shots.get(thread.screenshot)).toString("base64")
      const compared = await page.evaluate(compareShots, [shot, reference, BLOCK])
      const [sw, sh] = compared.size.shot
      const [vw, vh] = compared.size.viewport
      if (sw !== vw * 2 || sh !== vh * 2 || compared.mean === undefined)
        throw new Error(`sizes ${JSON.stringify(compared.size)}`)
      if (compared.mean > 2) throw new Error(`differs from the page by ${compared.mean.toFixed(2)} on average`)
      if (compared.block[0] < 200 || compared.block[1] > 40)
        throw new Error(`block is ${JSON.stringify(compared.block)}`)
      if (compared.pill.some((v) => v < 245))
        throw new Error(`the pill shows in the shot: ${JSON.stringify(compared.pill)}`)
      return compared
    },
    30_000,
  )

  out.checks.reload = await step("the comment is still there after a reload", async () => {
    await page.reload()
    await ui.locator("[data-act=list]:not([hidden])").waitFor()
    const title = await ui.locator("[data-act=list]").getAttribute("title")
    if (!/^1 open comment\b/.test(title ?? "")) throw new Error(`list says ${title}`)
    return { title, hosts: await ui.count() }
  })

  out.checks.noTokens = await step("no token reaches the page", async () => {
    const html = await page.content()
    const seen = await page.evaluate(() =>
      JSON.stringify({
        host: globalThis.__dropReviewHost ?? null,
        storage: [Object.entries(sessionStorage), Object.entries(localStorage)],
      }),
    )
    const leaked = fake.secrets().filter((secret) => html.includes(secret) || seen.includes(secret))
    if (leaked.length) throw new Error(`${leaked.length} token(s) on the page`)
    return { checked: fake.secrets().length }
  })

  const own = await context.newPage()
  await own.goto(`${ACME}/pricing?own`)
  const ownUi = own.locator("drop-review")

  out.checks.takeOver = await step(
    "a page running Drop's review.js hands over to the extension: one pill, and the comment lands in the review",
    async () => {
      await until(
        () => own.evaluate(() => window.__dropReview === true && document.querySelectorAll("drop-review").length === 1),
        "the page's own pill",
      )
      await press(own)
      await until(() => own.evaluate(() => window.__dropReview === false), "the page's pill to yield")
      await ownUi.getByRole("button", { name: "Comment", exact: true }).waitFor()
      const hosts = await ownUi.count()
      if (hosts !== 1) throw new Error(`${hosts} pills`)
      await compose(own, "Taken over")
      await ownUi.getByRole("button", { name: "Send" }).click()
      await until(() => sent(REVIEW.id).some((t) => t.body === "Taken over"), "the comment in the review")
      if ((await ownUi.count()) !== 1) throw new Error("a second pill appeared")
      return { hosts, review: sent(REVIEW.id).length }
    },
    30_000,
  )

  out.checks.targetSwitch = await step("switching to My notes sends the next comment to the notes", async () => {
    await ownUi.locator("[data-act=list]:not([hidden])").click()
    await ownUi.getByRole("combobox", { name: "Where comments go" }).selectOption("notes")
    await own.waitForTimeout(500)
    await compose(own, "Note to self")
    await ownUi.getByRole("button", { name: "Send" }).click()
    const notes = await until(() => fake.notesDrops.get(ACME), "the notes drop")
    await until(() => sent(notes).length === 1, "the note")
    if (sent(REVIEW.id).some((t) => t.body === "Note to self")) throw new Error("the note went to the review")
    return { notes: sent(notes).map((t) => t.body), review: sent(REVIEW.id).length }
  })
} finally {
  await context.close()
  server.close()
  rmSync(profile, { recursive: true, force: true })
}

report(out, "pill-chromium")
