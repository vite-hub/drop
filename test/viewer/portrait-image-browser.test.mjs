import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { typesetStylesheet } from "comark-ui/client"
import { chromium } from "playwright"
import { test } from "vite-plus/test"
import { renderMarkdownDocument } from "../../server/utils/markdown-document.ts"
import { migrate } from "../cost/harness.mjs"

migrate()

test("a direct Markdown page fits portrait images without stretching the zoom or resizing screenshots", async () => {
  const origin = "https://portrait.test"
  const path = "/f/portrait.md"
  const image = `${origin}/portrait.svg`
  const markdown = `:::screenshot{src="${image}" alt="Screenshot"}
::::annotation{x=5 y=5 w=20 h=20}
Mark.
::::
:::

**![Bold portrait](${image})**

| Photo |
| --- |
| ![Table portrait](${image}) |

![Sized portrait](${image}){width="400" height="1000"}
`
  const document = await renderMarkdownDocument(async () => markdown, path, "portrait.md")
  assert.match(document, /<strong><img[^>]+alt="Bold portrait"/)
  assert.match(document, /<td><img[^>]+alt="Table portrait"/)
  assert.match(document, /<img(?=[^>]+alt="Sized portrait")(?=[^>]+width="400")(?=[^>]+height="1000")/)
  const [localStyles, shell, zoom, mediumZoom] = await Promise.all(
    [
      "../../shared/typeset.css",
      "../../shared/document-shell.css",
      "../../public/document-zoom.js",
      "../../node_modules/medium-zoom/dist/medium-zoom.min.js",
    ].map((file) => readFile(new URL(file, import.meta.url), "utf8")),
  )

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.route(`${origin}${path}`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: document.replace(
          "</head>",
          `<style>${typesetStylesheet(".typeset")}${localStyles}${shell}</style></head>`,
        ),
      }),
    )
    await page.route(image, (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="1000"><rect width="400" height="1000"/></svg>',
      }),
    )
    await page.route(`${origin}/document-zoom.js`, (route) =>
      route.fulfill({ contentType: "text/javascript", body: zoom }),
    )
    await page.route(`${origin}/vendor/medium-zoom/medium-zoom.min.js`, (route) =>
      route.fulfill({ contentType: "text/javascript", body: mediumZoom }),
    )
    await page.goto(`${origin}${path}`)

    const screenshot = page.locator(".ca-frame img")
    assert.equal(await screenshot.evaluate((img) => getComputedStyle(img).maxHeight), "none")

    for (const alt of ["Bold portrait", "Table portrait", "Sized portrait"]) {
      const portrait = page.locator(`img[alt="${alt}"]`)
      await portrait.scrollIntoViewIfNeeded()
      await portrait.evaluate((img) => img.decode())
      const { width, height } = await portrait.boundingBox()
      assert.deepEqual([width, height], [224, 560], alt)
    }

    await page.getByRole("button", { name: "Zoom Sized portrait" }).click()
    const clone = page.locator(".medium-zoom-image--opened")
    await clone.waitFor()
    const { width, height } = await clone.boundingBox()
    assert.ok(Math.abs(width / height - 0.4) < 0.001)
  } finally {
    await browser.close()
  }
}, 30_000)
