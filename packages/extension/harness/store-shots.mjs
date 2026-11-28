import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { createServer as createHttps } from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { DROP, startDrop } from "./drop.mjs"
import { PORT } from "./server.mjs"

const extension = fileURLToPath(new URL("../.output-e2e/chrome-mv3", import.meta.url))
const shots = fileURLToPath(new URL("../store/screenshots/", import.meta.url))
const headless = process.env.DROP_E2E_HEADED !== "1"
const SIZE = { width: 1280, height: 800 }
const SITE = "https://www.example.com"
const SITE_PORT = 47832
const REVIEW = { id: "review-pricing", name: "Pricing page", access: "Team" }
const STORE_DROP = "https://drop.vitehub.dev"

const PLANS = [
  ["starter", "Starter", "$0", "For trying things out", "Start free"],
  ["team", "Team", "$12", "For small teams that ship every week", "Start trial"],
  ["business", "Business", "$29", "For companies with many projects", "Start trial"],
]

const pricing = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pricing · Acme</title><style>
*{box-sizing:border-box}body{margin:0;background:#fafaf9;color:#1c1917;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{display:flex;align-items:center;gap:32px;padding:20px 56px;border-bottom:1px solid #e7e5e4;background:#fff}
.logo{font-weight:700;font-size:20px;letter-spacing:-.01em}nav{display:flex;gap:24px;color:#57534e;font-size:15px}
nav b{color:#1c1917;font-weight:500}.sign{margin-left:auto;font-size:15px;color:#57534e}
main{max-width:1040px;margin:0 auto;padding:56px 24px}h1{margin:0;text-align:center;font-size:40px;letter-spacing:-.02em}
.lead{margin:12px 0 28px;text-align:center;color:#57534e;font-size:18px}
#billing{display:flex;justify-content:center;gap:4px;margin:0 auto 40px;width:max-content;padding:4px;border-radius:999px;background:#e7e5e4;font-size:13px}
#billing span{padding:4px 12px;border-radius:999px}#billing .on{background:#fff}
.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.plan{padding:28px;border:1px solid #e7e5e4;border-radius:12px;background:#fff}
.plan h2{margin:0;font-size:18px}.price{margin:12px 0 4px;font-size:36px;font-weight:700}.price small{font-size:15px;font-weight:400;color:#78716c}
.plan p{margin:0 0 24px;color:#57534e;font-size:15px;min-height:45px}
.plan a{display:block;padding:10px;border-radius:8px;border:1px solid #d6d3d1;text-align:center;color:inherit;text-decoration:none;font-weight:500}
ul{margin:24px 0 0;padding:0;list-style:none;font-size:14px;color:#44403c}li{padding:4px 0}li:before{content:"✓  ";color:#16a34a}
</style></head><body><header><span class="logo">Acme</span><nav><span>Product</span><b>Pricing</b><span>Docs</span><span>Blog</span></nav><span class="sign">Sign in</span></header>
<main><h1>Simple pricing for growing teams</h1><p class="lead">Every plan includes unlimited projects and a 14-day trial.</p>
<div id="billing"><span class="on">Monthly</span><span>Yearly · save 20%</span></div><div class="plans">${PLANS.map(
  ([id, name, price, about, cta]) =>
    `<section class="plan" id="${id}"><h2>${name}</h2><div class="price">${price}<small> / person / month</small></div><p>${about}</p><a href="#" id="${id}-cta">${cta}</a><ul><li>Unlimited projects</li><li>${id === "starter" ? "3 people" : "Unlimited people"}</li><li>${id === "business" ? "Single sign-on" : "Email support"}</li></ul></section>`,
).join("")}</div></main></body></html>`

const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => resolve(server))
  })

function certificate() {
  const dir = mkdtempSync(join(tmpdir(), "drop-store-cert-"))
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=www.example.com"]
      .concat(["-addext", "subjectAltName=DNS:www.example.com"])
      .concat(["-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")]),
    { stdio: "ignore" },
  )
  const tls = { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }
  rmSync(dir, { recursive: true, force: true })
  return tls
}

function servePricing(_req, res) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
  res.end(pricing)
}

mkdirSync(shots, { recursive: true })
const { fake, local } = await startDrop()
fake.reviews.set(SITE, [REVIEW])
const dropServer = await listen(
  createServer((req, res) => local(req, res, new URL(req.url, DROP))),
  PORT,
)
const siteServer = await listen(createHttps(certificate(), servePricing), SITE_PORT)
const profile = mkdtempSync(join(tmpdir(), "drop-store-shots-"))
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless,
  ignoreHTTPSErrors: true,
  viewport: SIZE,
  deviceScaleFactor: 1,
  colorScheme: "light",
  locale: "en-US",
  args: [
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    "--enable-unsafe-extension-debugging",
    "--ignore-certificate-errors",
    `--host-resolver-rules=MAP www.example.com 127.0.0.1:${SITE_PORT}`,
    "--lang=en-US",
  ],
})

const written = []
const button = (page, name) => page.getByRole("button", { name, exact: true })
async function shot(page, name, options = {}) {
  await page.waitForTimeout(300)
  const path = join(shots, `${name}.png`)
  await page.screenshot({ path, ...options })
  written.push(path)
}

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const id = new URL(worker.url()).host
  const welcomeUrl = `chrome-extension://${id}/welcome.html`
  let welcome = context.pages().find((page) => page.url() === welcomeUrl)
  for (let tries = 0; !welcome && tries < 50; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    welcome = context.pages().find((page) => page.url() === welcomeUrl)
  }
  if (!welcome) throw new Error("The welcome tab didn't open.")
  await welcome.setViewportSize(SIZE)
  await welcome.waitForSelector("h1")

  await shot(welcome, "welcome-1-what")
  await button(welcome, "Get started").click()
  await shot(welcome, "welcome-2-where")
  await button(welcome, "Continue").click()
  await welcome.getByText("Connect to your Drop").waitFor()
  await shot(welcome, "welcome-3-connect")
  await button(welcome, "Skip for now").click()
  await welcome.getByRole("radio", { name: /Only when I press/ }).waitFor()
  await shot(welcome, "welcome-4-hand")

  async function background(type, payload = {}) {
    const reply = await welcome.evaluate(
      ([kind, fields]) => chrome.runtime.sendMessage({ ...fields, type: kind }),
      [type, payload],
    )
    if (!reply?.ok) throw new Error(`${type}: ${reply?.error}`)
    return reply.value
  }
  await background("deployment.set", { drop: DROP })
  const linked = await background("link.start")
  if (!linked.ok) throw new Error(`not linked: ${linked.problem} ${linked.detail}`)

  const site = await context.newPage()
  await site.goto(`${SITE}/pricing`)
  await site.bringToFront()
  const cdp = await context.browser().newBrowserCDPSession()
  const { targetInfos } = await cdp.send("Target.getTargets", { filter: [{ type: "tab" }] })
  const tab = targetInfos.find((info) => info.url.startsWith(SITE))
  await cdp.send("Extensions.triggerAction", { id, targetId: tab.targetId })
  await cdp.detach()
  const ui = site.locator("drop-review")
  await ui.getByRole("button", { name: "Comment", exact: true }).waitFor()
  for (const popup of context.pages().filter((page) => page.url().endsWith("/popup.html"))) await popup.close()
  await site.bringToFront()

  async function compose(selector, words) {
    const box = await site.locator(selector).boundingBox()
    await ui.getByRole("button", { name: "Comment", exact: true }).click()
    await ui.locator(".draw:not([hidden])").waitFor()
    await site.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await ui.getByRole("textbox", { name: "Comment" }).fill(words)
  }

  let sent = 0
  for (const [selector, words] of [
    ["#billing", "The yearly switch is easy to miss. Can it be bigger?"],
    ["#team h2", "Team should be the highlighted plan."],
  ]) {
    await compose(selector, words)
    await ui.getByRole("button", { name: "Send" }).click()
    await ui.getByText(`Sent as #${++sent}.`).waitFor()
    await ui.getByText(/^Sent as #/).waitFor({ state: "hidden", timeout: 20_000 })
  }
  await compose("#business-cta", "Business needs a Contact sales button too.")
  await shot(site, "pill-comment")
  await site.keyboard.press("Escape")
  await site.waitForTimeout(300)
  await ui.locator("[data-act=list]:not([hidden])").click()
  await shot(site, "pill-list")
  await ui.locator("[data-act=list]:not([hidden])").click()
  await site.mouse.move(SIZE.width - 40, 40)
  await site.waitForTimeout(300)
  const page = (await site.screenshot()).toString("base64")

  await worker.evaluate(async (drop) => {
    const { link } = await chrome.storage.local.get("link")
    await chrome.storage.local.set({ drop, link: { ...link, drop, name: "Ada Example", email: "ada@example.com" } })
  }, STORE_DROP)
  const popup = await context.newPage()
  await popup.setViewportSize({ width: 320, height: 300 })
  await popup.addInitScript((origin) => {
    const query = chrome.tabs.query.bind(chrome.tabs)
    chrome.tabs.query = async (filter) =>
      filter?.active ? (await query({ url: `${origin}/*` })).slice(0, 1) : query(filter)
  }, SITE)
  await popup.goto(`chrome-extension://${id}/popup.html`)
  await popup.getByTestId("account").waitFor()
  await popup.waitForTimeout(300)
  const height = await popup.evaluate(() => document.querySelector("main").getBoundingClientRect().height)
  const panel = (await popup.screenshot({ clip: { x: 0, y: 0, width: 320, height: Math.ceil(height) } })).toString(
    "base64",
  )
  await popup.close()

  const frame = await context.newPage()
  await frame.setContent(
    `<body style="margin:0;width:${SIZE.width}px;height:${SIZE.height}px;overflow:hidden;position:relative">` +
      `<img src="data:image/png;base64,${page}" style="display:block">` +
      `<img src="data:image/png;base64,${panel}" style="position:absolute;top:8px;right:24px;border-radius:8px;` +
      `box-shadow:0 0 0 1px rgba(0,0,0,.08),0 12px 32px rgba(0,0,0,.18)"></body>`,
  )
  await shot(frame, "popup")
  console.log(written.join("\n"))
} finally {
  await context.close()
  dropServer.close()
  siteServer.close()
  rmSync(profile, { recursive: true, force: true })
}
