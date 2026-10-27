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

test("direct Markdown initializes Mermaid copy under its CSP and keeps copying after zoom setup", async () => {
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
    assert.equal(await page.locator(".drop-mermaid-tools").count(), 2)
    assert.equal(await page.locator(".mermaid[data-zoom]").count(), 2)
    assert.deepEqual(await page.evaluate(() => window.cspViolations), [])

    const layout = () =>
      page.locator(".drop-mermaid").evaluateAll((figures) =>
        figures.map((figure) => {
          const box = figure.getBoundingClientRect()
          return {
            top: box.top,
            height: box.height,
            diagramHeight: figure.querySelector(".mermaid").getBoundingClientRect().height,
          }
        }),
      )
    const initialLayout = await layout()
    assert.ok(initialLayout.every(({ height, diagramHeight }) => height === diagramHeight))
    assert.equal(
      await page
        .locator(".drop-mermaid-tools")
        .first()
        .evaluate((el) => getComputedStyle(el).opacity),
      "0",
    )

    // The diagram and both actions remain in the natural tab order, even while their icons are visually hidden.
    await page.keyboard.press("Tab")
    assert.ok(
      await page
        .locator(".mermaid[data-zoom]")
        .first()
        .evaluate((el) => el === document.activeElement),
    )
    assert.equal(
      await page
        .locator(".drop-mermaid-tools")
        .first()
        .evaluate((el) => getComputedStyle(el).opacity),
      "1",
    )
    await page.keyboard.press("Tab")
    assert.ok(
      await page
        .getByRole("button", { name: "Copy image", exact: true })
        .first()
        .evaluate((el) => el === document.activeElement && getComputedStyle(el).outlineStyle !== "none"),
    )
    await page.keyboard.press("Tab")
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.querySelector("[role=status]").textContent === "Markdown copied")
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "```mermaid\n" + source + "```")
    assert.deepEqual(await layout(), initialLayout, "copy feedback must not move or resize the diagrams")

    await page.locator(".drop-mermaid").last().hover()
    await page.getByRole("button", { name: "Copy Markdown", exact: true }).last().click()
    await page.waitForFunction(() =>
      [...document.querySelectorAll("[role=status]")].some((node) => node.textContent === "Markdown copied"),
    )
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "```mermaid\n" + source + "```")

    await page.locator(".drop-mermaid").first().hover()
    await page.getByRole("button", { name: "Copy image", exact: true }).first().focus()
    await page.keyboard.press("Enter")
    await page.waitForFunction(() => document.querySelector("[role=status]").textContent === "Image copied")
    assert.ok(
      await page
        .getByRole("button", { name: "Copy image", exact: true })
        .first()
        .evaluate((el) => el === document.activeElement),
      "PNG conversion must preserve keyboard focus",
    )
    assert.ok(
      await page
        .getByRole("button", { name: "Copy image", exact: true })
        .first()
        .evaluate(
          (el) =>
            el.hasAttribute("data-copied") &&
            getComputedStyle(el.querySelector(".drop-mermaid-check")).display !== "none",
        ),
    )
    assert.deepEqual(await layout(), initialLayout)
    const png = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      const blob = await item.getType("image/png")
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement("canvas")
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext("2d")
      ctx.drawImage(bitmap, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      return {
        size: blob.size,
        width: bitmap.width,
        height: bitmap.height,
        drawn: pixels.some((value, index) => index % 4 !== 3 && value < 240),
        opaque: pixels.every((value, index) => index % 4 !== 3 || value === 255),
      }
    })
    assert.ok(png.size > 0 && png.width > 0 && png.height > 0)
    assert.ok(png.width <= 4096 && png.height <= 4096)
    assert.ok(png.drawn, "the copied PNG contains the diagram, not just its background")
    assert.ok(png.opaque, "the copied PNG has an opaque background")

    await page.waitForFunction(() => !document.querySelector(".drop-mermaid-tools button").hasAttribute("data-copied"))

    const touch = await browser.newContext({ viewport: { width: 320, height: 700 }, hasTouch: true, isMobile: true })
    const phone = await touch.newPage()
    await phone.goto(`http://127.0.0.1:${server.address().port}${path}`)
    const touchControls = await phone
      .locator(".drop-mermaid-tools")
      .first()
      .evaluate((el) => {
        const button = el.querySelector("button").getBoundingClientRect()
        return { opacity: getComputedStyle(el).opacity, width: button.width, height: button.height }
      })
    assert.equal(touchControls.opacity, "1", "touch readers can discover actions without hovering")
    assert.ok(touchControls.width >= 44 && touchControls.height >= 44)
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth))

    // Denied clipboard access keeps a visible, persistent fallback instead of reporting a successful copy.
    await phone.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }))
    await phone.getByRole("button", { name: "Copy image", exact: true }).first().tap()
    await phone.getByRole("link", { name: "Open PNG", exact: true }).waitFor({ state: "visible" })
    assert.match(await phone.locator("[role=status]").first().innerText(), /Couldn't copy the image/)
    await phone.getByRole("button", { name: "Copy Markdown", exact: true }).first().tap()
    assert.match(await phone.locator("[role=status]").first().innerText(), /Markdown is selected/)
    assert.equal(await phone.evaluate(() => getSelection().toString()), "```mermaid\n" + source + "```")
    await touch.close()

    await page.locator(".mermaid[data-zoom]").first().click()
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
