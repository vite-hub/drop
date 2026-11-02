import assert from "node:assert/strict"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { beforeEach, test } from "vite-plus/test"
import { insertDrop, migrate, reset, state, who } from "../cost/harness.mjs"
const { default: readDrop } = await import("../../server/mcp/tools/read_drop.ts")

// Comments without a Database answers every call with COMMENTS_NOT_INSTALLED, as on drop.vitehub.dev on 2026-11-02.
migrate({ comments: false })
beforeEach(() => {
  reset()
  state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
})

const server = createMcpHandler({ name: "drop-test", version: "1", origin: false, tools: [readDrop] })
async function read(id) {
  const request = new H3Event(
    new Request("https://drop.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "read_drop", arguments: { id } },
      }),
    }),
  )
  request.context.log = { set() {}, error() {}, warn() {} }
  const text = await (await toResponse(await server(request), request)).text()
  const { result } = JSON.parse(text.startsWith("{") ? text : text.match(/^data: (.+)$/m)[1])
  assert.ok(!result.isError, result.content?.[0]?.text)
  return result
}

test("read_drop returns a doc's content when Comments can't be read, and says so instead of None", async () => {
  insertDrop("doc")
  const result = await read("doc")
  assert.equal(result.structuredContent.content, "# Source")
  assert.deepEqual(result.structuredContent.comments, [])
  assert.match(result.structuredContent.commentsUnavailable, /may have open comments/)
  assert.match(result.content[0].text, /## Open comments\nComments couldn't be read just now/)
  assert.doesNotMatch(result.content[0].text, /## Open comments\nNone\./)
  assert.match(result.content[0].text, /## Content\n# Source/)
})

test("read_drop returns a site when its comments can't be read", async () => {
  insertDrop("site", { kind: "site", site_url: "https://example.com" })
  const result = await read("site")
  assert.equal(result.structuredContent.siteUrl, "https://example.com")
  assert.match(result.structuredContent.commentsUnavailable, /may have open comments/)
})
