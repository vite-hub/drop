import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { PROXY, SITES, startServer } from "./server.mjs"
import { report, step } from "./util.mjs"

const extension = fileURLToPath(new URL("../.output/chrome-mv3", import.meta.url))
const headless = process.env.DROP_E2E_HEADED !== "1"
const out = { browser: "chromium", checks: {} }

const server = await startServer()
const profile = mkdtempSync(join(tmpdir(), "drop-e2e-chromium-"))
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
  ],
})

try {
  out.version = context.browser()?.version()
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const id = new URL(worker.url()).host

  out.checks.welcome = await step("the welcome tab opens on install", async () => {
    const welcome = `chrome-extension://${id}/welcome.html`
    while (!context.pages().some((p) => p.url() === welcome)) await new Promise((resolve) => setTimeout(resolve, 200))
    return welcome
  })

  out.checks.freshProfile = await step(
    "a fresh profile injects nothing on five sites",
    async () => {
      const hosts = []
      for (const url of SITES) {
        const page = await context.newPage()
        await page.goto(url)
        await page.waitForTimeout(1000)
        hosts.push({ url, hosts: await page.locator("drop-review").count() })
        await page.close()
      }
      if (hosts.some((h) => h.hosts !== 0)) throw new Error(`injected: ${JSON.stringify(hosts)}`)
      return hosts
    },
    30_000,
  )

  out.checks.toolbar = await step(
    "the toolbar button opens the popup, which injects <drop-review>",
    async () => {
      const page = await context.newPage()
      await page.goto(SITES[0])
      await page.bringToFront()
      const session = await context.browser().newBrowserCDPSession()
      const { targetInfos } = await session.send("Target.getTargets", { filter: [{ type: "tab" }] })
      const target = targetInfos.find((t) => t.url === SITES[0])
      await session.send("Extensions.triggerAction", { id, targetId: target.targetId })
      await page.waitForSelector("drop-review", { state: "attached", timeout: 10_000 })
      return { hosts: await page.locator("drop-review").count() }
    },
    20_000,
  )
} finally {
  await context.close()
  server.close()
  rmSync(profile, { recursive: true, force: true })
}

report(out, "chromium")
