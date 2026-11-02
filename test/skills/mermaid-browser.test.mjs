import assert from "node:assert/strict"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { toResponse } from "h3"
import { chromium } from "playwright"
import { beforeEach, test } from "vite-plus/test"
import { event, migrate, objects, reset } from "../cost/harness.mjs"

const { default: markdownDocument } = await import("../../server/middleware/1.markdown-documents.ts")

migrate()
beforeEach(reset)

test("direct Markdown runs comark-ui's Mermaid copy and zoom under its CSP, and blocks the doc's own scripts", async () => {
  const key = "00000000-0000-4000-8000-000000000001.md"
  const path = `/f/${key}`
  const source = 'graph LR\n A["A & B"] --> B["Copied diagram"]\n'
  const markdown = ("```mermaid\n" + source + "```\n\n").repeat(2)
  objects.set(key, { body: new Blob([markdown]) })
  const request = event(path)
  request.context.dropAccessChecked = true
  const response = await toResponse(await markdownDocument(request), request)
  assert.equal(response.status, 200)
  const policy = response.headers.get("content-security-policy")
  assert.match(policy, /script-src 'self'/)
  assert.doesNotMatch(policy.match(/script-src[^;]+/)[0], /unsafe-inline|unsafe-eval/)

  // Vitest empties CSS imports, including ?raw. Keep the browser on the document's actual styles.
  const styles = await Promise.all(
    ["../../shared/typeset.css", "../../shared/document-shell.css"].map((file) =>
      readFile(new URL(file, import.meta.url), "utf8"),
    ),
  )
  const body = (await response.text()).replace("</head>", `<style>${styles.join("\n")}</style></head>`)

  // Serve the real middleware output and both deferred assets, so Chromium enforces the response CSP and load order.
  const assets = new Map([
    [path, { headers: Object.fromEntries(response.headers), body }],
    ...(await Promise.all(
      [
        ["/document-zoom.js", "../../public/document-zoom.js"],
        ["/vendor/medium-zoom/medium-zoom.min.js", "../../node_modules/medium-zoom/dist/medium-zoom.min.js"],
      ].map(async ([url, file]) => [
        url,
        {
          headers: { "content-type": "text/javascript" },
          body: await readFile(new URL(file, import.meta.url), "utf8"),
        },
      ]),
    )),
  ])
  const server = createServer((req, res) => {
    const asset = assets.get(req.url)
    res.writeHead(asset ? 200 : 404, asset?.headers)
    res.end(asset?.body)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  let browser
  try {
    browser = await chromium.launch()
    const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] })
    const page = await context.newPage()
    await page.addInitScript(() => {
      window.cspViolations = []
      document.addEventListener("securitypolicyviolation", (event) => window.cspViolations.push(event.blockedURI))
    })
    await page.goto(`http://127.0.0.1:${server.address().port}${path}`)
    // comark-ui's copy runtime starts under the page's CSP: its buttons only show once it has.
    await page.waitForFunction(() => document.documentElement.hasAttribute("data-mermaid-ready"))
    assert.equal(await page.locator(".cmm-bar").count(), 2)
    assert.equal(await page.locator(".pele-diagram[data-zoom]").count(), 2)
    assert.deepEqual(await page.evaluate(() => window.cspViolations), [])

    await page.locator(".cmm").first().hover()
    await page.getByRole("button", { name: "Copy source", exact: true }).first().click()
    await page.waitForFunction(() => document.querySelector(".cmm-status").textContent === "Source copied")
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /A\["A & B"\] --> B\["Copied diagram"\]/)

    await page.locator(".pele-diagram[data-zoom]").first().click()
    await page.locator(".cz-dialog").waitFor()
    await page.keyboard.press("Escape")

    // Author-provided inline code remains blocked; only the exact copy runtime is authorized.
    await page.evaluate(() => {
      const script = document.createElement("script")
      script.textContent = "window.untrustedScriptRan = true"
      document.body.append(script)
    })
    await page.waitForFunction(() => window.cspViolations.includes("inline"))
    assert.equal(await page.evaluate(() => window.untrustedScriptRan), undefined)
  } finally {
    await browser?.close()
    await new Promise((resolve) => server.close(resolve))
  }
}, 30_000)
