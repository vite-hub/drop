import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { chromium } from "playwright"
import { beforeEach, test } from "vite-plus/test"
import { migrate, reset } from "../cost/harness.mjs"
import { PREVIEW_SANDBOX } from "../../app/utils/feedback.ts"
import { planDocument } from "../../shared/documents.ts"
import { deferMedia, embeddedMediaPaths } from "../../shared/embedded-images.ts"

const { renderMarkdownCached } = await import("../../server/utils/markdown-document.ts")

migrate()
beforeEach(reset)

const escapeAttribute = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")

test("a private video in a Markdown doc plays in the viewer's sandboxed frame", async () => {
  const browser = await chromium.launch()
  const server = createServer()
  try {
    const page = await browser.newPage()
    // A second of WebM from a canvas: Chromium records it, so the test needs no video file or encoder.
    const video = Buffer.from(
      await page.evaluate(async () => {
        const canvas = Object.assign(document.createElement("canvas"), { width: 64, height: 36 })
        const context = canvas.getContext("2d")
        const recorder = new MediaRecorder(canvas.captureStream(10), { mimeType: "video/webm" })
        const chunks = []
        recorder.ondataavailable = (event) => chunks.push(event.data)
        const stopped = new Promise((resolve) => (recorder.onstop = resolve))
        recorder.start()
        for (let frame = 0; frame < 10; frame++) {
          context.fillStyle = `hsl(${frame * 36} 80% 50%)`
          context.fillRect(0, 0, 64, 36)
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        recorder.stop()
        await stopped
        return [...new Uint8Array(await new Blob(chunks).arrayBuffer())]
      }),
    )

    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    const host = `127.0.0.1:${server.address().port}`
    const path = "/f/11111111-1111-4111-8111-111111111111.webm"
    const markdown = `# Recording\n\n![The upload flow](http://${host}${path}){muted}\n`
    const { html } = await renderMarkdownCached("video", async () => markdown)
    const paths = embeddedMediaPaths([markdown, html], host)
    assert.deepEqual(paths, [path])
    const frame = (body) =>
      `<iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escapeAttribute(planDocument("markdown", markdown, false, body))}"></iframe>`
    // The viewer's half (useViewerFrame and useAttachmentData): fetch each file the frame asks for as the reader.
    const viewer = `<!doctype html>${frame(deferMedia(html, paths))}${frame(html)}<script>
      addEventListener("message", async (event) => {
        if (event.data?.type !== "files") return
        for (const path of event.data.paths) {
          const data = await (await fetch(path)).blob()
          event.source.postMessage({ __drop: true, type: "file-data", path, data }, "*")
        }
      })
    </script>`
    // Drop's /f/ answers a private file only with the reader's session, which Lax keeps out of a sandboxed frame.
    server.on("request", (req, res) => {
      if (req.url === "/d/doc") {
        res.writeHead(200, { "content-type": "text/html", "set-cookie": "session=1; SameSite=Lax; Path=/" })
        return res.end(viewer)
      }
      if (req.url === path && req.headers.cookie?.includes("session=1")) {
        res.writeHead(200, { "content-type": "video/webm" })
        return res.end(video)
      }
      res.writeHead(404).end()
    })

    // The cookie first, then the doc, as a reader who signed in earlier.
    await page.goto(`http://${host}/d/doc`)
    await page.goto(`http://${host}/d/doc`)
    const [handedIn, direct] = page.frames().slice(1)
    await handedIn.waitForFunction(() => document.querySelector(".cm-video > video")?.readyState >= 1)
    assert.match(await handedIn.$eval(".cm-video > video", (element) => element.src), /^blob:null\//)
    assert.equal(await handedIn.$eval(".cm-video", (element) => element.hasAttribute("data-error")), false)
    await direct.waitForFunction(() => document.querySelector(".cm-video > video")?.error)
  } finally {
    await browser.close()
    server.close()
  }
})
