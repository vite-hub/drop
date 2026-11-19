import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { sql, state, migrate, reset, who } from "../cost/harness.mjs"
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: readDrop } = await import("../../server/mcp/tools/read_drop.ts")
const { createDocDrop } = await import("../../server/utils/drops.ts")

migrate()
beforeEach(() => {
  reset()
  state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
})

const server = createMcpHandler({ name: "drop-test", version: "1", origin: false, tools: [publish, readDrop] })
async function call(tool, input) {
  const request = new H3Event(
    new Request("https://drop.example/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool.name, arguments: input },
      }),
    }),
  )
  request.context.log = { set() {}, error() {}, warn() {} }
  const text = await (await toResponse(await server(request), request)).text()
  const body = JSON.parse(text.startsWith("{") ? text : text.match(/^data: (.+)$/m)[1])
  if (body.error) return { isError: true, message: body.error.message }
  const result = body.result
  return result.isError ? { isError: true, message: result.content.map((block) => block.text).join(" ") } : result
}

const versions = (id) => [
  sql.prepare("SELECT version FROM drops WHERE id = ?").get(id).version,
  sql.prepare("SELECT COUNT(*) AS n FROM drop_versions WHERE drop_id = ?").get(id).n,
]

async function twoVersions() {
  const doc = (await call(publish, { markdown: "# Plan\n\nOne", note: "First", lifetime: "review" })).structuredContent
  await call(publish, { previous: doc.id, markdown: "# Plan\n\nTwo", note: "Someone else's" })
  return doc
}

test("a stale base is refused with a conflict that names the latest, and publishes nothing", async () => {
  const doc = await twoVersions()
  const stale = await call(publish, { previous: doc.id, base: 1, markdown: "# Plan\n\nMine", note: "From v1" })
  assert.equal(stale.isError, true)
  assert.match(stale.message, /v2 is the latest version of \w+, not v1/)
  assert.match(stale.message, /Call read_drop for \w+ again.*publish with base: 2/)
  assert.deepEqual(versions(doc.id), [2, 1])

  // An app's next version is refused the same way, before any file is written.
  const app = (await call(publish, { files: { "index.html": "<p>1</p>" }, note: "First", lifetime: "review" }))
    .structuredContent
  const staleApp = await call(publish, { previous: app.id, base: 2, files: { "index.html": "<p>2</p>" }, note: "x" })
  assert.match(staleApp.message, /v1 is the latest version/)
  assert.equal(sql.prepare("SELECT version FROM drops WHERE id = ?").get(app.id).version, 1)
})

test("the write itself refuses a stale base, so a version published after publish's check still conflicts", async () => {
  const doc = await twoVersions()
  await assert.rejects(
    createDocDrop(state.who, {
      filename: "doc.md",
      bytes: new TextEncoder().encode("# Plan\n\nRaced"),
      supersedes: doc.id,
      base: 1,
      note: "Raced",
    }),
    { status: 409 },
  )
  assert.deepEqual(versions(doc.id), [2, 1])
})

test("the base the agent read publishes the next version, from any link to the drop", async () => {
  const doc = await twoVersions()
  const read = await call(readDrop, { id: doc.id })
  assert.match(read.content[0].text, /## Versions\nPublish the next version with base 2, the version you read\./)
  const next = await call(publish, { previous: `${doc.url}?v=1`, base: 2, markdown: "# Plan\n\nThree", note: "On v2" })
  assert.equal(next.structuredContent.version, 3)
  assert.deepEqual(versions(doc.id), [3, 2])
  // An earlier version read through its pinned link says nothing about base: it isn't the one to build on.
  const pinned = await call(readDrop, { id: `${doc.url}?v=1` })
  assert.doesNotMatch(pinned.content[0].text, /base \d/)
})

test("without base, a stale previous still goes on top of the latest", async () => {
  const doc = await twoVersions()
  const next = await call(publish, { previous: `${doc.url}?v=1`, markdown: "# Plan\n\nThree", note: "No base" })
  assert.equal(next.isError, undefined)
  assert.equal(next.structuredContent.version, 3)
  assert.match(
    (await call(publish, { base: 1, markdown: "# New", note: "x", lifetime: "review" })).message,
    /pass previous with it/,
  )
})

test("agent.session is stored with its version and read back in Versions", async () => {
  const session = {
    harness: "T3 Code",
    thread: "thread-0f3a",
    project: "drop",
    worktree: "/work/drop/send",
    branch: "feat/send",
  }
  const agent = { model: "claude-opus-5-5", harness: "Claude Code", session }
  const doc = (await call(publish, { markdown: "# Plan", note: "First", lifetime: "review", agent })).structuredContent
  await call(publish, {
    previous: doc.id,
    base: 1,
    markdown: "# Plan\n\nTwo",
    note: "Second",
    agent: { harness: "Codex" },
  })
  const read = await call(readDrop, { id: doc.id })
  assert.deepEqual(
    read.structuredContent.versions.map((version) => version.agent),
    [{ harness: "Codex" }, agent],
  )
  assert.match(
    read.content[0].text,
    /v1: First \(.+ · claude-opus-5-5 · Claude Code · session harness "T3 Code", thread "thread-0f3a", project "drop", worktree "\/work\/drop\/send", branch "feat\/send"\)/,
  )
  assert.match(read.content[0].text, /v2: Second \(.+ · Codex\)\n/)

  for (const bad of [
    { thread: "a\nb" },
    { project: "\u0001" },
    { harness: "   " },
    { branch: "" },
    { worktree: "x".repeat(161) },
    { thread: 7 },
  ]) {
    const result = await call(publish, { markdown: "# Bad", note: "Bad", lifetime: "review", agent: { session: bad } })
    assert.equal(result.isError, true, JSON.stringify(bad))
  }
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM drops").get().n, 1)
})
