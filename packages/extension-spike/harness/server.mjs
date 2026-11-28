// Local test server for the spike. HTTP on SPIKE_HTTP_PORT (default 47810), WebSocket on SPIKE_WS_PORT (47811).
// Run: node harness/server.mjs   Writes its pid to results/server.pid.
import { createServer } from "node:http"
import { randomBytes } from "node:crypto"
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import { WebSocketServer } from "ws"

const HTTP_PORT = Number(process.env.SPIKE_HTTP_PORT ?? 47810)
const WS_PORT = Number(process.env.SPIKE_WS_PORT ?? 47811)
const results = new URL("../results/", import.meta.url)
mkdirSync(results, { recursive: true })
writeFileSync(new URL("server.pid", results), String(process.pid))
const wsLog = new URL("ws-server.log", results)

function log(line) {
  const text = `${new Date().toISOString()} ${line}`
  console.log(text)
  return text
}

function cookies(req) {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key]) => key),
  )
}

const page = (title, body = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body style="margin:0"><h1>${title}</h1>${body}</body></html>`

createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  log(`GET ${url.pathname}${url.search} cookie=${req.headers.cookie ?? "-"}`)
  switch (url.pathname) {
    case "/page":
    case "/page2":
      res.writeHead(200, { "content-type": "text/html" })
      return res.end(page(`Spike ${url.pathname}`, `<a id="next" href="/page2">next</a>`))
    case "/csp":
      res.writeHead(200, {
        "content-type": "text/html",
        "content-security-policy": "default-src 'none'",
      })
      return res.end(page("Strict CSP page", "<p>default-src 'none'</p>"))
    case "/session": {
      const existing = cookies(req).sid
      const sid = existing ?? randomBytes(6).toString("hex")
      res.writeHead(200, {
        "content-type": "text/html",
        ...(existing ? {} : { "set-cookie": `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600` }),
      })
      return res.end(page("Session", `<p id="sid">${sid}</p>`))
    }
    case "/auth": {
      const redirect = url.searchParams.get("redirect_uri")
      if (!redirect) {
        res.writeHead(400)
        return res.end("redirect_uri missing")
      }
      const target = new URL(redirect)
      target.searchParams.set("code", cookies(req).sid ?? "none")
      res.writeHead(302, { location: target.href })
      return res.end()
    }
  }
  res.writeHead(404)
  res.end("not found")
}).listen(HTTP_PORT, "127.0.0.1", () => log(`http on ${HTTP_PORT}`))

let next = 0
new WebSocketServer({ port: WS_PORT, host: "127.0.0.1" }).on("connection", (socket, req) => {
  const id = ++next
  const opened = Date.now()
  appendFileSync(wsLog, `${log(`ws#${id} open ${req.url}`)}\n`)
  // Echo only by default, so an idle client gets no events. SPIKE_WS_PUSH_SECONDS=N makes the server send a
  // message every N seconds, to test whether server traffic alone keeps the background alive.
  socket.on("message", (data) => socket.send(data))
  const push = Number(process.env.SPIKE_WS_PUSH_SECONDS ?? 0)
  const timer = push > 0 ? setInterval(() => socket.send("tick"), push * 1000) : undefined
  socket.on("close", (code) => {
    clearInterval(timer)
    appendFileSync(wsLog, `${log(`ws#${id} close code=${code} after ${((Date.now() - opened) / 1000).toFixed(1)}s`)}\n`)
  })
})
log(`ws on ${WS_PORT}`)
