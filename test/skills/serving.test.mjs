import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { parseTarGzip } from "nanotar"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { migrate } from "../cost/harness.mjs"
const { default: discovery } = await import("../../server/handlers/skills.ts")
const { mcpSkills, skillResources } = await import("../../server/utils/mcp-skills.ts")

migrate()
const root = new URL("../../skills/", import.meta.url)
const sha256 = async (bytes) =>
  `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`

async function get(path) {
  const event = new H3Event(new Request(`https://drop.example${path}`))
  event.context.log = { set() {}, error() {} }
  return discovery(event)
}

// On the 2026-07-28 revision, where the Skills extension lives: every request carries its version and capabilities.
const server = createMcpHandler(
  { name: "drop-test", version: "1", origin: false, resources: skillResources },
  { extensionPlugins: [mcpSkills()] },
)
async function mcp(method, params = {}) {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": { extensions: { "io.modelcontextprotocol/skills": {} } },
  }
  const event = new H3Event(
    new Request("https://drop.example/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": method,
        ...(params.uri && method === "resources/read" ? { "mcp-name": params.uri } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: meta } }),
    }),
  )
  event.context.log = { set() {}, error() {}, warn() {} }
  const text = await (await toResponse(await server(event), event)).text()
  return JSON.parse(text.startsWith("{") ? text : text.match(/^data: (.+)$/m)[1])
}

test("Discovery v0.2.0: a multi-file skill is a tar.gz of the skill directory, SKILL.md at its root, matching its digest", async () => {
  const index = await (await get("/.well-known/agent-skills/index.json")).json()
  assert.equal(index.$schema, "https://schemas.agentskills.io/discovery/0.2.0/schema.json")
  const entry = index.skills.find((skill) => skill.name === "prototype")
  assert.equal(entry.type, "archive")
  assert.equal(entry.url, "/.well-known/agent-skills/prototype.tar.gz")

  const response = await get(entry.url)
  assert.equal(response.headers.get("content-type"), "application/gzip")
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.equal(entry.digest, await sha256(bytes))
  const files = await parseTarGzip(bytes)
  assert.deepEqual(files.map((file) => file.name).sort(), ["SKILL.md", "assets/picker.js", "references/canvas.md"])
  assert.equal(
    files.find((file) => file.name === "assets/picker.js").text,
    await readFile(new URL("prototype/assets/picker.js", root), "utf8"),
  )

  const single = index.skills.find((skill) => skill.name === "handoff")
  assert.equal(single.type, "skill-md")
  assert.equal(single.digest, await sha256(new Uint8Array(await (await get(single.url)).arrayBuffer())))
})

test("each skill file is served on its own with its content type, and v0.1.0 lists the files", async () => {
  const picker = await get("/.well-known/agent-skills/prototype/assets/picker.js")
  assert.equal(picker.headers.get("content-type"), "text/javascript; charset=utf-8")
  assert.equal(
    (await get("/.well-known/skills/prototype/SKILL.md")).headers.get("content-type"),
    "text/markdown; charset=utf-8",
  )
  const v1 = await (await get("/.well-known/skills/index.json")).json()
  const v2 = await (await get("/.well-known/agent-skills/index.json")).json()
  const prototype = v1.skills.find((skill) => skill.name === "prototype")
  assert.equal(prototype.version, v2.skills.find((skill) => skill.name === "prototype").digest.slice(7, 19))
  assert.deepEqual(prototype.files, ["SKILL.md", "assets/picker.js", "references/canvas.md"])
})

test("MCP Skills extension: skills/list names every file with its digest and size, and resources/read serves each", async () => {
  const listed = await mcp("skills/list")
  assert.equal(listed.error, undefined, listed.error?.message)
  const skill = listed.result.skills.find((item) => item.frontmatter.name === "prototype")
  assert.equal(skill.uri, "skill://prototype/SKILL.md")
  assert.deepEqual(
    skill.resources.map((item) => item.uri),
    ["skill://prototype/SKILL.md", "skill://prototype/assets/picker.js", "skill://prototype/references/canvas.md"],
  )

  for (const item of skill.resources) {
    const read = await mcp("resources/read", { uri: item.uri })
    assert.equal(read.error, undefined, read.error?.message)
    const [content] = read.result.contents
    const bytes = new TextEncoder().encode(content.text)
    assert.equal(bytes.byteLength, item.size)
    assert.equal(await sha256(bytes), item.digest)
    assert.equal(content.mimeType, item.uri.endsWith(".js") ? "text/javascript" : "text/markdown")
  }

  assert.deepEqual((await mcp("skills/get", { uri: skill.uri })).result.skill, skill)
  const missing = await mcp("resources/read", { uri: "skill://prototype/assets/nothing.js" })
  assert.equal(missing.error.code, -32602)
})

test("pr-evidence serves bundled comark-ui references through discovery and MCP", async () => {
  const path = "references/comark-ui/references/annotate.md"
  const expected = await readFile(
    new URL("../../node_modules/comark-ui/dist/skills/comark-ui/references/annotate.md", import.meta.url),
    "utf8",
  )
  assert.equal(await (await get(`/.well-known/skills/pr-evidence/${path}`)).text(), expected)
  const response = await mcp("resources/read", { uri: `skill://pr-evidence/${path}` })
  assert.equal(response.result.contents[0].text, expected)
})
