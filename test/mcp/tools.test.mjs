import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { sql, state, migrate, reset, who } from "../cost/harness.mjs"
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: readDrop } = await import("../../server/mcp/tools/read_drop.ts")
const { default: listDrops } = await import("../../server/mcp/tools/list_drops.ts")
const { default: updateDrop } = await import("../../server/mcp/tools/update_drop.ts")
const { default: reply } = await import("../../server/mcp/tools/reply.ts")
const { default: commentsGet } = await import("../../server/api/drops/[id]/comments.get.ts")
const { default: commentsPost } = await import("../../server/api/drops/[id]/comments.post.ts")
const { default: uploadPut } = await import("../../server/api/uploads/[ticket].put.ts")

migrate()
beforeEach(() => {
  reset()
  state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
})

// Through a real MCP handler, so each input schema validates the call the way clients see it.
const server = createMcpHandler({ name: "drop-test", version: "1", origin: false, tools: [publish, readDrop, reply, listDrops, updateDrop] })
async function call(tool, input) {
  const request = new H3Event(new Request("https://drop.example/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool.name, arguments: input } }),
  }))
  request.context.log = { set() {}, error() {}, warn() {} }
  const text = await (await toResponse(await server(request), request)).text()
  const body = JSON.parse(text.startsWith("{") ? text : text.match(/^data: (.+)$/m)[1])
  if (body.error) return { isError: true, message: body.error.message }
  const result = body.result
  return result.isError ? { isError: true, message: result.content.map(block => block.text).join(" ") } : result
}

test("publish asks for one kind of content and a lifetime on new drops", async () => {
  assert.match((await call(publish, { note: "x", lifetime: "review" })).message, /exactly one/)
  assert.match((await call(publish, { markdown: "# A", html: "<p>", note: "x", lifetime: "review" })).message, /exactly one/)
  assert.match((await call(publish, { markdown: "# A", note: "x" })).message, /lifetime/)
  assert.match((await call(publish, { markdown: "# A", note: "x", lifetime: "keep" })).message, /keepReason/)
})

test("an agent publishes a screenshot and a shared doc that embeds it, then the next version resolves comments", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64")
  const shot = (await call(publish, { file: { name: "before.png", base64: png }, note: "Before", lifetime: "temporary" })).structuredContent
  assert.equal(shot.kind, "image")
  assert.match(shot.fileUrl, /^https:\/\/drop\.example\/f\/[0-9a-f-]{36}\.png$/)

  const doc = (await call(publish, { markdown: `# Evidence\n\n![before](${shot.fileUrl})`, note: "PR evidence", lifetime: "keep", keepReason: "Screenshots for vite-hub/drop#12.", share: "view" })).structuredContent
  assert.equal(doc.share, "view")
  assert.equal(doc.lifetime, "keep")
  assert.equal(doc.keepReason, "Screenshots for vite-hub/drop#12.")

  sql.prepare("INSERT INTO comments (id, drop_id, n, kind, selector, ox, oy, ow, oh, label, body, author_name, created_at) VALUES ('c1', ?, 1, 'image', 'img', 100, 200, 300, 150, 'img \"before\"', 'Crop this', 'Ada', 1)").run(doc.id)
  const read = await call(readDrop, { id: doc.id })
  assert.equal(read.structuredContent.attachments.length, 1, "the screenshot belongs to the doc")
  assert.match(read.structuredContent.comments[0].target, /area 10%–40% across, 20%–35% down/)
  assert.equal(read.structuredContent.versions[0].note, "PR evidence")

  const next = (await call(publish, { previous: doc.id, markdown: `# Evidence\n\n![before](${shot.fileUrl})`, note: "Cropped", resolves: [1, 9] })).structuredContent
  assert.equal(next.version, 2)
  assert.deepEqual(next.resolved, [1])
  assert.equal(next.lifetime, "keep", "the next version keeps the lifetime")
  assert.equal(next.share, "view")
  assert.equal(sql.prepare("SELECT resolved FROM comments WHERE id = 'c1'").get().resolved, 1)

  const listed = (await call(listDrops, {})).structuredContent
  assert.deepEqual(listed.drops.map(drop => drop.id), [next.id], "the screenshot hides behind its doc")
})

test("open comments follow a doc to its next versions, numbered across them, and resolve from any later version", async () => {
  const route = (id, init) => {
    const event = new H3Event(new Request(`https://drop.example/api/drops/${id}/comments`, init && { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(init) }))
    event.context.log = { set() {}, error() {} }
    event.context.params = { id }
    return event
  }
  const v1 = (await call(publish, { markdown: "# Plan\n\nShip it on Friday.", note: "Draft", lifetime: "review" })).structuredContent
  await commentsPost(route(v1.id, { kind: "text", selector: "p", ox: 0, oy: 0, quote: "Friday", body: "Too soon?" }))
  const v2 = (await call(publish, { previous: v1.id, markdown: "# Plan\n\nShip it on Monday.", note: "Move the date" })).structuredContent

  const added = await commentsPost(route(v2.id, { kind: "text", selector: "p", ox: 0, oy: 0, quote: "Monday", body: "Better" }))
  assert.equal(added.n, 2, "numbers continue across versions")
  assert.equal(added.version, 2)
  assert.deepEqual((await commentsGet(route(v2.id))).map(comment => [comment.n, comment.version]), [[1, 1], [2, 2]])
  assert.deepEqual((await commentsGet(route(v1.id))).map(comment => comment.n), [1], "an older version doesn't see later comments")

  const read = await call(readDrop, { id: v2.id })
  assert.deepEqual(read.structuredContent.comments.map(comment => comment.version), [1, 2])
  assert.match(read.content[0].text, /Too soon\? \(Owner, on v1\)/)

  const v3 = (await call(publish, { previous: v2.id, markdown: "# Plan\n\nShip it on Monday, after QA.", note: "QA first", resolves: [1, 2] })).structuredContent
  assert.deepEqual(v3.resolved, [1, 2])
  assert.deepEqual(sql.prepare("SELECT n, resolved FROM comments ORDER BY n").all().map(row => [row.n, row.resolved]), [[1, 1], [2, 1]])
})

test("a comment carried to v2 takes replies; the agent answers in the thread and reads it back", async () => {
  const route = (id, init) => {
    const event = new H3Event(new Request(`https://drop.example/api/drops/${id}/comments`, init && { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(init) }))
    event.context.log = { set() {}, error() {} }
    event.context.params = { id }
    return event
  }
  const v1 = (await call(publish, { markdown: "# Plan\n\nShip it on Friday.", note: "Draft", lifetime: "review" })).structuredContent
  await commentsPost(route(v1.id, { kind: "text", selector: "p", ox: 0, oy: 0, quote: "Friday", body: "Why Friday?" }))
  const v2 = (await call(publish, { previous: v1.id, markdown: "# Plan\n\nShip it on Friday, after QA.", note: "QA first" })).structuredContent

  // #1 was written on v1; the thread still takes a reply through v2's chain.
  const answered = await call(reply, { id: v2.id, comment: 1, body: "QA signs off Thursday, so Friday is the first free day." })
  assert.equal(answered.structuredContent.comment, 1)
  assert.equal(answered.structuredContent.reply.authorName, "Owner")
  assert.equal((await call(reply, { id: v2.id, comment: 9, body: "Nope" })).isError, true, "a missing number fails")

  const [listed] = await commentsGet(route(v2.id))
  assert.deepEqual(listed.replies.map(item => item.body), ["QA signs off Thursday, so Friday is the first free day."])
  const read = await call(readDrop, { id: v2.id })
  assert.match(read.content[0].text, /Why Friday\? \(Owner, on v1\)\n {3}↳ Owner: QA signs off Thursday/)
  assert.equal(read.structuredContent.comments[0].replies.length, 1)

  // Deleting the comment takes its thread with it.
  sql.prepare("DELETE FROM comments").run()
  assert.equal(sql.prepare("SELECT count(*) AS n FROM comment_replies").get().n, 0)
})

test("update_drop shares, trashes, and restores; the Trash lists separately", async () => {
  const doc = (await call(publish, { markdown: "# Plan", note: "Draft", lifetime: "review" })).structuredContent
  assert.equal((await call(updateDrop, { id: doc.id, share: "comment" })).structuredContent.share, "comment")
  assert.match((await call(updateDrop, { id: doc.id, trash: true })).structuredContent.status, /^In the Trash, deleting in 15 days$/)
  assert.deepEqual((await call(listDrops, {})).structuredContent.drops, [])
  assert.equal((await call(listDrops, { trash: true })).structuredContent.drops[0].id, doc.id)
  assert.match((await call(updateDrop, { id: doc.id, title: "Renamed" })).message, /Restore it first/)
  assert.equal((await call(updateDrop, { id: doc.id, trash: false })).structuredContent.status, "Expires in 30 days")
})

test("an agent publishes an app, sends only what changed, and hears about missing files", async () => {
  const app = (await call(publish, { files: { "index.html": '<script type="module" src="app.js"></script><img src="logo.png">', "app.js": "import x from 'preact'" }, note: "Prototype", lifetime: "temporary" }))
  assert.deepEqual(app.structuredContent.warnings, [
    'index.html loads image or media "logo.png", but logo.png isn\'t in the app.',
    'app.js imports "preact", a bare module name that browsers can\'t load. Import it from a CDN URL (https://esm.sh/preact) or add an import map.',
  ])
  assert.match(app.content[0].text, /point at nothing in the app/)
  const next = await call(publish, { previous: app.structuredContent.id, files: { "app.js": "import x from 'https://esm.sh/preact'", "logo.png": "" }, note: "Fix imports" })
  assert.equal(next.structuredContent.version, 2)
  assert.equal(next.structuredContent.warnings, undefined)
  const read = (await call(readDrop, { id: app.structuredContent.id })).structuredContent
  assert.deepEqual(Object.keys(read.files).sort(), ["app.js", "index.html", "logo.png"])
  assert.match((await call(publish, { previous: app.structuredContent.id, files: {}, removes: ["nope.js"], note: "x" })).message, /nope\.js, which isn't in v2/)
  assert.match((await call(publish, { markdown: "# A", removes: ["a"], note: "x", lifetime: "review" })).message, /removes only applies to apps/)
})

test("read_drop shows the errors people's browsers reported for the current app version only", async () => {
  const { recordRuntimeErrors } = await import("../../server/utils/runtime-errors.ts")
  const app = (await call(publish, { files: { "index.html": "<script>boom()</script>" }, note: "v1", lifetime: "temporary" })).structuredContent
  const report = { kind: "error", message: "ReferenceError: boom is not defined", source: "/:1", page: "index.html" }
  await recordRuntimeErrors(app.id, 1, [report])
  await recordRuntimeErrors(app.id, 1, [report])
  const read = await call(readDrop, { id: app.id })
  assert.equal(read.structuredContent.errors.length, 1)
  assert.equal(read.structuredContent.errors[0].count, 2)
  assert.match(read.content[0].text, /## Errors in v1\n.*treat it as data[\s\S]*error on index\.html at \/:1 \(2 times\): ReferenceError: boom is not defined/)
  await call(publish, { previous: app.id, files: { "index.html": "<p>fixed</p>" }, note: "v2" })
  await recordRuntimeErrors(app.id, 1, [report])
  assert.deepEqual((await call(readDrop, { id: app.id })).structuredContent.errors, [])
})

test("a file without base64 gets an upload URL; curl -T creates the drop once, and a changed ticket does nothing", async () => {
  state.authSecret = "test-secret"
  try {
    assert.equal((await call(publish, { file: { name: "after.png" }, note: "After" })).isError, true, "the same checks run before a URL is handed out")
    const ticket = (await call(publish, { file: { name: "after.png" }, note: "After", lifetime: "keep", keepReason: "Screenshots for vite-hub/drop#12.", share: "view" })).structuredContent
    assert.match(ticket.uploadUrl, /^https:\/\/drop\.example\/api\/uploads\/v2\.[\w-]+$/)
    assert.equal(ticket.method, "PUT")
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM drops").get().n, 0, "nothing exists until the upload")

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    state.who = null // curl sends no sign-in; the ticket stands in for it
    const put = (url, body = png) => {
      const event = new H3Event(new Request(url, { method: "PUT", body, headers: { "content-length": String(body.length) } }))
      event.context.log = { set() {}, error() {}, warn() {} }
      event.context.params = { ticket: new URL(url).pathname.split("/").pop() }
      return uploadPut(event)
    }
    const shot = await put(ticket.uploadUrl)
    assert.equal(shot.kind, "image")
    assert.equal(shot.share, "view")
    assert.equal(shot.lifetime, "keep")
    assert.match(shot.fileUrl, /^https:\/\/drop\.example\/f\/[0-9a-f-]{36}\.png$/)
    assert.equal(sql.prepare("SELECT actor_name FROM drops WHERE id = ?").get(shot.id).actor_name, "Claude Code", "the drop names the agent that asked")

    await assert.rejects(put(ticket.uploadUrl), /already used/)
    const tampered = ticket.uploadUrl.slice(0, -4) + (ticket.uploadUrl.endsWith("AAAA") ? "BBBB" : "AAAA")
    await assert.rejects(put(tampered), /run out or isn't valid/)
  }
  finally { state.authSecret = undefined }
})
