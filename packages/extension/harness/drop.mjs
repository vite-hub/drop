import { fileURLToPath } from "node:url"
import { runnerImport } from "vite-plus"
import { createFakeDrop } from "../test/fake-drop.ts"
import { PORT } from "./server.mjs"

export const DROP = `http://localhost:${PORT}`
export const ACME = `http://acme.localhost:${PORT}`
export const REVIEW = { id: "review-acme", name: "Acme launch", access: "Team" }
export const BLOCK = { left: 120, top: 160, width: 240, height: 120 }

const ROOT = fileURLToPath(new URL("../../..", import.meta.url))

async function pageScript() {
  const { module } = await runnerImport(`${ROOT}shared/review-script.ts`, {
    configFile: false,
    root: ROOT,
    logLevel: "error",
  })
  return module.REVIEW_SCRIPT
}

const acmePage = (path, own) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Acme ${path}</title></head>` +
  `<body style="margin:0;background:#fff;font:16px sans-serif">` +
  `<h1 style="margin:0;padding:24px 40px">Acme pricing</h1>` +
  `<div id="block" style="position:absolute;left:${BLOCK.left}px;top:${BLOCK.top}px;width:${BLOCK.width}px;height:${BLOCK.height}px;background:#e00000"></div>` +
  (own ? `<script src="${DROP}/review.js"></script>` : "") +
  `</body></html>`

export async function startDrop() {
  const fake = createFakeDrop(DROP)
  fake.options.reviewScript = await pageScript()
  fake.options.presence = false
  fake.reviews.set(ACME, [REVIEW])

  async function local(req, res, url) {
    if (url.origin === ACME) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      return res.end(acmePage(url.pathname, url.searchParams.has("own")))
    }
    if (url.origin !== DROP) {
      res.writeHead(404)
      return res.end()
    }
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    const headers = new Headers()
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value)
    const request = new Request(`${DROP}${url.pathname}${url.search}`, {
      method: req.method,
      headers,
      ...(body && req.method !== "GET" && req.method !== "HEAD" ? { body } : {}),
    })
    const response = await fake.fetch(request).catch((error) => new Response(String(error), { status: 500 }))
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  }

  return { fake, local }
}
