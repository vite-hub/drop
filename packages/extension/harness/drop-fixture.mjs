import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer as createHttp } from "node:http"
import { createServer as createHttps } from "node:https"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const HTTPS_PORT = Number(process.env.DROP_FIXTURE_HTTPS_PORT ?? 47832)
export const HTTP_PORT = Number(process.env.DROP_FIXTURE_HTTP_PORT ?? 47831)

const cors = { "access-control-allow-origin": "*" }

function hello(drop) {
  return { drop, name: "Acme Drop", version: "0.1.0" }
}

function answer(origin, path) {
  const host = new URL(origin).hostname
  if (path === "/api/review/notes/hello") {
    if (host === "drop.example.com" || host === "localhost" || host === "127.0.0.1") return [200, hello(origin)]
    if (host === "acme.example.com") return [200, hello("https://drop.example.com")]
    return [404, { error: "not found" }]
  }
  if (path === "/.well-known/oauth-authorization-server" && host === "old.example.com")
    return [200, { authorization_endpoint: `${origin}/api/auth/oauth2/authorize` }]
  if (path.startsWith("/api/") || path.startsWith("/.well-known/")) return [404, { error: "not found" }]
  return [
    200,
    `<!doctype html><meta charset="utf-8"><title>${host}</title><h1>${host}</h1><p>A page to try Drop on.</p>`,
  ]
}

function handler(scheme) {
  return (req, res) => {
    const origin = `${scheme}://${req.headers.host}`
    const [status, body] = answer(origin, new URL(req.url, origin).pathname)
    const html = typeof body === "string"
    res.writeHead(status, { ...cors, "content-type": html ? "text/html; charset=utf-8" : "application/json" })
    res.end(html ? body : JSON.stringify(body))
  }
}

const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => resolve(server))
  })

export async function startFixture() {
  const dir = mkdtempSync(join(tmpdir(), "drop-fixture-"))
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=example.com",
      "-addext",
      "subjectAltName=DNS:example.com,DNS:*.example.com",
      "-keyout",
      join(dir, "key.pem"),
      "-out",
      join(dir, "cert.pem"),
    ],
    { stdio: "ignore" },
  )
  const tls = { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) }
  rmSync(dir, { recursive: true, force: true })
  const https = await listen(createHttps(tls, handler("https")), HTTPS_PORT)
  const http = await listen(createHttp(handler("http")), HTTP_PORT)
  return {
    hostRules: `MAP *.example.com 127.0.0.1:${HTTPS_PORT}, MAP example.com 127.0.0.1:${HTTPS_PORT}`,
    close() {
      https.close()
      http.close()
    },
  }
}
