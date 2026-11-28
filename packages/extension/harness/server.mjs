import { createServer } from "node:http"

export const PORT = Number(process.env.DROP_E2E_PORT ?? 47830)
export const PROXY = `127.0.0.1:${PORT}`

export const SITES = [
  "http://example.com/",
  "http://example.org/pricing",
  "http://example.net/docs/start",
  "http://www.example.com/blog?page=2",
  "http://shop.example.org/cart",
]

const page = (host, path) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${host}${path}</title></head>` +
  `<body><h1>${host}</h1><p>${path}</p><a id="next" href="/next">next</a></body></html>`

export function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (
      !url.hostname.endsWith("example.com") &&
      !url.hostname.endsWith("example.org") &&
      !url.hostname.endsWith("example.net")
    ) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(page(url.hostname, `${url.pathname}${url.search}`))
  })
  server.on("connect", (_req, socket) => socket.end("HTTP/1.1 403 Forbidden\r\n\r\n"))
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(PORT, "127.0.0.1", () => resolve(server))
  })
}
