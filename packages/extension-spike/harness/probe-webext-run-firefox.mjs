// Row 8, option B: `web-ext run` installs the add-on (over RDP) and opens Firefox's remote agent; puppeteer then
// connects over WebDriver BiDi. Needs harness/server.mjs running.
// Usage: node harness/probe-webext-run-firefox.mjs <firefox binary> [bidi port, default 47812]
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import puppeteer from "puppeteer-core"

const firefox = process.argv[2]
const port = Number(process.argv[3] ?? 47812)
const uuid = "6f1c2a52-8d3e-4a1b-9c55-0e2f6a7b8c90"
const source = fileURLToPath(new URL("../.output/firefox-mv3", import.meta.url))
const webExt = fileURLToPath(new URL("../node_modules/.bin/web-ext", import.meta.url))
const args = [
  "run", "--firefox", firefox, "--source-dir", source, "--no-reload", "--no-input",
  "--pref", `extensions.webextensions.uuids=${JSON.stringify({ "drop-spike@example.com": uuid })}`,
  "--arg=-headless", `--arg=--remote-debugging-port=${port}`,
  "--start-url", "http://127.0.0.1:47810/page",
  // BiDi can't navigate a tab to moz-extension:// in 128, so web-ext opens the options page as a start URL instead.
  "--start-url", `moz-extension://${uuid}/options.html`,
]
console.log("web-ext", args.join(" "))
const child = spawn(webExt, args, { stdio: ["ignore", "pipe", "pipe"] })
let output = ""
child.stdout.on("data", (chunk) => (output += chunk))
child.stderr.on("data", (chunk) => (output += chunk))
const installed = await new Promise((resolve) => {
  const deadline = setTimeout(() => resolve(false), 60_000)
  const timer = setInterval(() => {
    if (/Installed .* as a temporary add-on/.test(output)) {
      clearTimeout(deadline)
      clearInterval(timer)
      resolve(true)
    }
  }, 250)
})
console.log("installed:", installed)
if (!installed) {
  console.log("web-ext output:\n" + output)
  child.kill("SIGKILL")
  process.exit(1)
}
try {
  const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}/session`, protocol: "webDriverBiDi" })
  console.log("connected:", await browser.version())
  const probe = await browser.newPage()
  await probe.goto(`moz-extension://${uuid}/options.html`).catch((error) => console.log("goto moz-extension:", error.message.split("\n")[0]))
  await probe.close()
  const pages = await browser.pages()
  console.log("open pages:", pages.map((p) => p.url()).join(", "))
  const page = pages.find((p) => p.url().startsWith("moz-extension://"))
  if (!page) throw new Error("the options start URL is not open")
  await page.waitForSelector("svg#icon path", { timeout: 5000 })
  console.log("options page icon paths:", await page.$$eval("#icon path", (paths) => paths.length))
  const result = await page.evaluate(async () => {
    const tabs = await browser.tabs.query({})
    return { tabs: tabs.length, events: ((await browser.storage.local.get("events")).events ?? []).map((e) => e.kind) }
  }).catch((error) => ({ evaluateError: error.message }))
  console.log("extension API from the page:", JSON.stringify(result))
  await browser.disconnect()
} catch (error) {
  console.log("puppeteer failed:", error.message)
}
child.kill("SIGINT")
await new Promise((resolve) => child.once("exit", resolve))
console.log("web-ext output tail:\n" + output.split("\n").slice(-8).join("\n"))
