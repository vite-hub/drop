import assert from "node:assert/strict"
import { once } from "node:events"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import { toResponse } from "h3"
import { chromium } from "playwright"
import { beforeEach, test } from "vite-plus/test"
import { event, insertDrop, migrate, objects, reset } from "../cost/harness.mjs"

const { default: markdownDocument } = await import("../../server/middleware/1.markdown-documents.ts")

migrate()
beforeEach(reset)

const shot = (fill) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="860"><rect width="1440" height="860" fill="${fill}"/></svg>`)}`

// A note above the screenshot whose point lies far to one side reads away from it, toward the screenshot's edge.
const markdown = `# Notes

::compare
:::screenshot{src="${shot("#ed2020")}" alt="Before" viewport="1440x860"}
:::
:::screenshot{src="${shot("#2020ed")}" alt="After" viewport="1440x860"}
::::annotation{x=10 y=15 w=6 h=6 mark="none" side="top" at=60 to="12,18"}
Filters first.
::::
:::
::

::screenshot{src="${shot("#16a34a")}" alt="Settings" viewport="1440x860"}
:::annotation{x=10 y=15 w=6 h=6 mark="none" side="top" at=92 to="12,18"}
The menu keeps the most recent values at the top, so the last filter is one click away.
:::
::
`

test("direct Markdown fits offset notes under its CSP: compare arrows show, standalone notes stay inside the page", async () => {
  const key = "00000000-0000-4000-8000-000000000002.md"
  const path = `/f/${key}`
  insertDrop("doc", { blob_key: key })
  objects.set(key, { body: new Blob([markdown]) })
  const request = event(path)
  const response = await toResponse(await markdownDocument(request), request)
  assert.equal(response.status, 200)
  assert.doesNotMatch(response.headers.get("content-security-policy").match(/script-src[^;]+/)[0], /unsafe-inline/)

  // Vitest empties CSS imports, including ?raw. Keep the browser on the document's actual styles.
  const styles = await Promise.all(
    ["../../shared/typeset.css", "../../shared/document-shell.css"].map((file) =>
      readFile(new URL(file, import.meta.url), "utf8"),
    ),
  )
  const body = (await response.text()).replace("</head>", `<style>${styles.join("\n")}</style></head>`)
  const server = createServer((req, res) => {
    const found = req.url === path
    res.writeHead(found ? 200 : 404, found ? Object.fromEntries(response.headers) : undefined)
    res.end(found ? body : undefined)
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  let browser
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1180, height: 900 } })
    await page.addInitScript(() => {
      window.cspViolations = []
      document.addEventListener("securitypolicyviolation", (event) => window.cspViolations.push(event.blockedURI))
    })
    await page.goto(`http://127.0.0.1:${server.address().port}${path}`)

    // The compare's notes start stacked; annotate's runtime puts the arrow back once the note fits.
    await page.waitForFunction(
      () => document.querySelector("[data-ca-fit-notes]")?.hasAttribute("data-ca-notes-fit"),
      undefined,
      { timeout: 10_000 },
    )
    const arrow = page.locator(".ca-compare .ca-arrow").first()
    assert.notEqual(await arrow.evaluate((element) => getComputedStyle(element).display), "none")
    assert.deepEqual(await page.evaluate(() => window.cspViolations), [])

    await page.setViewportSize({ width: 900, height: 900 })
    await page.waitForTimeout(100)
    const fit = await page.evaluate(() => {
      const note = document.querySelector(".ca:not(.ca-compare) .ca-callout").getBoundingClientRect()
      const image = document.querySelector(".ca:not(.ca-compare) .ca-stage img").getBoundingClientRect()
      return { page: document.documentElement.scrollWidth, noteRight: note.right, imageRight: image.right }
    })
    assert.ok(fit.page <= 900, `the page is ${fit.page}px wide in a 900px window`)
    assert.ok(
      fit.noteRight <= fit.imageRight + 1,
      `the note ends at ${fit.noteRight}, past the screenshot's ${fit.imageRight}`,
    )
  } finally {
    await browser?.close()
    await new Promise((resolve) => server.close(resolve))
  }
}, 30_000)
