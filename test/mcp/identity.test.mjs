import assert from "node:assert/strict"
import { test } from "node:test"
import { H3Event, toResponse } from "h3"
import { defineMcpHandler } from "h3-mcp"
import { defineMcpHandler as modernHandler } from "h3-mcp/modern"
import { defineMcpHandler as legacyHandler } from "h3-mcp/legacy"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { MCP_SERVER_INFO, MCP_LATEST, MCP_LEGACY } from "../../shared/mcp.ts"

const identity = {
  ...MCP_SERVER_INFO,
  description: "Drop's identity",
  websiteUrl: "https://drop.example",
  icons: [
    { src: "https://drop.example/favicon.svg", mimeType: "image/svg+xml", sizes: ["any"] },
    { src: "https://drop.example/icon.png", mimeType: "image/png", sizes: ["512x512"] },
  ],
}

async function request(handler, method, params, version) {
  const event = new H3Event(new Request("https://drop.example/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": version,
      "mcp-method": method,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }))
  const response = await toResponse(await handler(event), event)
  assert.equal(response.status, 200)
  const body = await response.text()
  const json = JSON.parse(body.startsWith("event:") ? body.match(/^data: (.+)$/m)[1] : body)
  assert.equal(json.error, undefined)
  return json.result
}

for (const [name, create, modern, legacy] of [
  ["toolkit", createMcpHandler, true, true],
  ["h3-mcp", defineMcpHandler, true, true],
  ["h3-mcp/modern", modernHandler, true, false],
  ["h3-mcp/legacy", legacyHandler, false, true],
]) {
  test(`${name} preserves the full server identity on the wire`, async () => {
    const handler = create({ ...identity, origin: false })
    if (modern) {
      for (const method of ["server/discover", "tools/list"]) {
        const result = await request(handler, method, {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": MCP_LATEST,
            "io.modelcontextprotocol/clientInfo": { name: "identity-test", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        }, MCP_LATEST)
        assert.deepEqual(result._meta["io.modelcontextprotocol/serverInfo"], identity)
      }
    }
    if (legacy) {
      for (const protocolVersion of MCP_LEGACY) {
        const result = await request(handler, "initialize", {
          protocolVersion,
          clientInfo: { name: "identity-test", version: "1.0.0" },
          capabilities: {},
        }, protocolVersion)
        assert.deepEqual(result.serverInfo, identity)
      }
    }
  })
}
