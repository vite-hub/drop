import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

// DROP_URL=<deployment> pnpm test:e2e:deployed runs the public checks: pages, OAuth discovery, and that
// agents must sign in. Add DROP_TOKEN=<an MCP access token> for the signed-in flow (uploads, sharing, MCP).
const origin = new URL(process.env.DROP_URL ?? "https://drop.vitehub.dev")
const token = process.env.DROP_TOKEN
const timeout = () => AbortSignal.timeout(30_000)
const filesEndpoint = new URL("/api/files", origin)

const homepage = await fetch(origin, { signal: timeout() })
assert.equal(homepage.status, 200)
assert.match(await homepage.text(), /og\.png/)

const mediumZoom = await fetch(new URL("/vendor/medium-zoom/medium-zoom.min.js", origin), { signal: timeout() })
assert.equal(mediumZoom.status, 200)
assert.match(await mediumZoom.text(), /medium-zoom-image/)

// Uploading needs a signed-in person or an approved agent.
const anonymous = new FormData()
anonymous.set("file", new File(["# nope"], "nope.md", { type: "text/markdown" }))
const refused = await fetch(filesEndpoint, { body: anonymous, method: "POST", signal: timeout() })
assert.equal(refused.status, 401)
await refused.body?.cancel()

// MCP is an OAuth protected resource: the 401 points at its metadata, which names Drop's authorization server.
const challenge = await fetch(new URL("/mcp", origin), {
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  headers: { "content-type": "application/json", "accept": "application/json, text/event-stream" },
  method: "POST",
  signal: timeout(),
})
assert.equal(challenge.status, 401)
await challenge.body?.cancel()
const resourceMetadataUrl = challenge.headers.get("www-authenticate")?.match(/resource_metadata="([^"]+)"/)?.[1]
assert.ok(resourceMetadataUrl, "401 from /mcp carries resource_metadata")
const resource = await (await fetch(resourceMetadataUrl, { signal: timeout() })).json()
assert.equal(resource.resource, new URL("/mcp", origin).href)
const issuer = resource.authorization_servers[0]
assert.equal(issuer, new URL("/api/auth", origin).href)
const server = await (await fetch(new URL(`/.well-known/oauth-authorization-server${new URL(issuer).pathname}`, origin), { signal: timeout() })).json()
assert.equal(server.issuer, issuer)
assert.ok(server.registration_endpoint, "dynamic client registration is on")
assert.ok(server.code_challenge_methods_supported.includes("S256"))

// Agent Skills Discovery v0.2.0: the archive's digest matches the index.
const index = await (await fetch(new URL("/.well-known/agent-skills/index.json", origin), { signal: timeout() })).json()
assert.equal(index.$schema, "https://schemas.agentskills.io/discovery/0.2.0/schema.json")
const archive = new Uint8Array(await (await fetch(new URL(index.skills[0].url, origin), { signal: timeout() })).arrayBuffer())
const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", archive)), byte => byte.toString(16).padStart(2, "0")).join("")
assert.equal(index.skills[0].digest, `sha256:${hash}`)

assert.equal((await fetch(new URL(`/f/code-images/${Date.now() - 1000}/expired.svg`, origin), { signal: timeout() })).status, 404)

if (!token) {
  console.log("Public checks passed. Set DROP_TOKEN to an MCP access token to run the signed-in flow.")
  process.exit(0)
}
const auth = { authorization: `Bearer ${token}` }

const form = new FormData()
form.set("file", new File([await readFile(new URL("../../public/og.png", import.meta.url))], "og.png"))
const upload = await (await fetch(filesEndpoint, { body: form, headers: auth, method: "POST", signal: timeout() })).json()
assert.match(new URL(upload.url).pathname, /^\/f\/[0-9a-f-]+\.png$/)
assert.equal(upload.visibility, "private")

// Private: its owner reads it, everyone else gets a 404.
assert.equal((await fetch(upload.url, { signal: timeout() })).status, 404)
const image = await fetch(upload.url, { headers: auth, signal: timeout() })
assert.equal(image.status, 200)
assert.equal(image.headers.get("content-type"), "image/png")

// Shared: anyone with the link.
const share = await fetch(new URL(`/api/drops/${upload.id}`, origin), {
  body: JSON.stringify({ visibility: "shared" }),
  headers: { ...auth, "content-type": "application/json" },
  method: "PATCH",
  signal: timeout(),
})
assert.equal(share.status, 200)
assert.equal((await fetch(upload.url, { signal: timeout() })).status, 200)

// Old /i/ links redirect to /f/.
const legacy = await fetch(new URL(new URL(upload.url).pathname.replace(/^\/f\//, "/i/"), origin), { redirect: "manual", signal: timeout() })
assert.equal(legacy.status, 301)
assert.equal(new URL(legacy.headers.get("location"), origin).pathname, new URL(upload.url).pathname)

const markdownSource = "---\ntitle: Smoke-test plan\n---\n\n# Smoke-test plan\n\n```mermaid\ngraph LR\n  Upload --> Render\n```\n"
const markdownForm = new FormData()
markdownForm.set("file", new File([markdownSource], "plan.md", { type: "text/markdown" }))
const markdownUpload = await fetch(filesEndpoint, { body: markdownForm, headers: auth, method: "POST", signal: timeout() })
assert.equal(markdownUpload.status, 200)

const markdownUrl = new URL((await markdownUpload.json()).url, origin)
assert.match(markdownUrl.pathname, /^\/f\/[0-9a-f-]+\.md$/)

const markdownPage = await fetch(markdownUrl, { headers: auth, signal: timeout() })
assert.equal(markdownPage.status, 200)
assert.equal(markdownPage.headers.get("content-type"), "text/html; charset=utf-8")
assert.equal(markdownPage.headers.get("cache-control"), "private, no-store")
assert.match(await markdownPage.text(), /<div class="mermaid"><svg/)
assert.match(markdownPage.headers.get("content-security-policy"), /script-src 'self'/)

markdownUrl.search = "?raw"
const markdownRaw = await fetch(markdownUrl, { headers: auth, signal: timeout() })
assert.equal(markdownRaw.status, 200)
assert.match(markdownRaw.headers.get("content-type") ?? "", /^text\/markdown/)
assert.equal(await markdownRaw.text(), markdownSource)

// Raw HTML never runs on Drop's origin: the blob route serves it under a CSP sandbox.
const htmlForm = new FormData()
htmlForm.set("file", new File(["<!doctype html><script>fetch('/api/me')</script>"], "report.html", { type: "text/html" }))
const htmlUpload = await fetch(filesEndpoint, { body: htmlForm, headers: auth, method: "POST", signal: timeout() })
assert.equal(htmlUpload.status, 200)
const htmlRaw = new URL((await htmlUpload.json()).url, origin)
htmlRaw.search = "?raw"
const htmlRawResponse = await fetch(htmlRaw, { headers: auth, signal: timeout() })
assert.equal(htmlRawResponse.status, 200)
assert.match(htmlRawResponse.headers.get("content-security-policy") ?? "", /^sandbox/)

// MCP (2026-07-28) with the same token; the protocol version rides in each request's _meta.
const mcp = async (method, params = {}) => (await fetch(new URL("/mcp", origin), {
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "e2e", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } }),
  headers: { ...auth, "content-type": "application/json", "accept": "application/json, text/event-stream", "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...(params.name || params.uri ? { "mcp-name": params.name ?? params.uri } : {}) },
  method: "POST",
  signal: timeout(),
})).json()
assert.ok((await mcp("server/discover")).result.capabilities.extensions["io.modelcontextprotocol/skills"])
assert.deepEqual((await mcp("tools/list")).result.tools.map(tool => tool.name), ["list_drops", "read_drop", "list_comments", "create_doc", "publish_app", "create_code_image"])
assert.match((await mcp("tools/call", { name: "create_doc", arguments: { markdown: "# From MCP" } })).result.content[0].text, /^Dropped privately: /)
const [skill] = (await mcp("skills/list")).result.skills
assert.equal(skill.frontmatter.name, "vitehub-drop")
assert.match((await mcp("resources/read", { uri: skill.uri })).result.contents[0].text, /^---\nname: vitehub-drop/)

// SVG comes straight from Shiki, no browser involved.
const svgResponse = await fetch(new URL("/api/code", origin), {
  body: JSON.stringify({ code: "const answer = 42", language: "ts", format: "svg" }),
  headers: { ...auth, "content-type": "application/json" },
  method: "POST",
  signal: timeout(),
})
assert.equal(svgResponse.status, 200)
const svgImage = await fetch(new URL((await svgResponse.json()).url, origin), { signal: timeout() })
assert.equal(svgImage.headers.get("content-type"), "image/svg+xml")
assert.match(await svgImage.text(), /^<svg/)

// PNG is one Browser Run screenshot of that SVG.
const codeResponse = await fetch(new URL("/api/code", origin), {
  body: JSON.stringify({ code: "const answer: number = 42", language: "typescript", theme: "nuxt" }),
  headers: { ...auth, "content-type": "application/json" },
  method: "POST",
  signal: AbortSignal.timeout(120_000),
})
assert.equal(codeResponse.status, 200)

const codeImage = await fetch(new URL((await codeResponse.json()).url, origin), { signal: timeout() })
assert.equal(codeImage.status, 200)
assert.equal(codeImage.headers.get("content-type"), "image/png")
assert.deepEqual(
  Buffer.from(await codeImage.arrayBuffer()).subarray(0, 8),
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
)
