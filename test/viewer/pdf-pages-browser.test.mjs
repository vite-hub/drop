import assert from "node:assert/strict"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createServer } from "vite-plus"
import { test } from "vite-plus/test"

const root = fileURLToPath(new URL("../../node_modules/.cache/pdf-pages-browser/", import.meta.url))
const pdfPages = fileURLToPath(new URL("../../app/utils/pdf-pages.ts", import.meta.url))
rmSync(root, { force: true, recursive: true })
mkdirSync(root, { recursive: true })
writeFileSync(`${root}index.html`, '<script type="module" src="/main.js"></script>')
writeFileSync(`${root}main.js`, `import * as pages from "/@fs${pdfPages}"\nObject.assign(window, pages)\n`)

// Two US Letter pages, written by hand: page 1 links "https://example.com/" from the box 72,700 to 272,720 (points,
// from the bottom left); page 2 has the same box linking to page 1, which an image of a page can't follow.
const fixture = readFileSync(new URL("./fixtures/links.pdf", import.meta.url))

test(
  "a PDF's pages draw as JPEG images 1240 pixels wide, A4 at 150 dpi, with their web links in per-mille",
  { timeout: 60_000 },
  async () => {
    const server = await createServer({
      configFile: false,
      root,
      logLevel: "warn",
      optimizeDeps: { noDiscovery: true },
      server: { host: "127.0.0.1", port: 0 },
    })
    const browser = await chromium.launch()
    try {
      await server.listen()
      const page = await browser.newPage()
      await page.route("**/fixture.pdf", (route) => route.fulfill({ contentType: "application/pdf", body: fixture }))
      await page.goto(server.resolvedUrls.local[0])
      await page.waitForFunction(() => typeof window.openPdf === "function")
      const result = await page.evaluate(async () => {
        const pdf = await openPdf("/fixture.pdf")
        const first = await renderPage(pdf, 1)
        const image = new Image()
        image.src = first.src
        await image.decode()
        const result = {
          pages: pdf.numPages,
          first: { width: first.width, height: first.height, jpeg: first.src.startsWith("data:image/jpeg;base64,") },
          decoded: { width: image.naturalWidth, height: image.naturalHeight },
          small: await renderPage(pdf, 2, { width: 400 }).then(({ width, height }) => ({ width, height })),
          links: [await pageLinks(pdf, 1), await pageLinks(pdf, 2)],
        }
        await pdf.loadingTask.destroy()
        return result
      })
      assert.equal(result.pages, 2)
      assert.deepEqual(result.first, { width: 1240, height: 1605, jpeg: true })
      assert.deepEqual(result.decoded, { width: 1240, height: 1605 })
      assert.deepEqual(result.small, { width: 400, height: 518 })
      // 72/612, (792 - 720)/792, 200/612 and 20/792 of the page.
      assert.deepEqual(result.links, [[{ x: 118, y: 91, w: 327, h: 25, href: "https://example.com/" }], []])
    } finally {
      await browser.close()
      await server.close()
    }
  },
)
