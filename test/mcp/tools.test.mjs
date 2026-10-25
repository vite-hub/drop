import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { createTarGzip } from "nanotar"
import { objects, sql, state, migrate, reset, who, calls, insertDrop } from "../cost/harness.mjs"
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: readDrop } = await import("../../server/mcp/tools/read_drop.ts")
const { default: readFile } = await import("../../server/mcp/tools/read_file.ts")
const { default: listDrops } = await import("../../server/mcp/tools/list_drops.ts")
const { default: updateDrop } = await import("../../server/mcp/tools/update_drop.ts")
const { default: reply } = await import("../../server/mcp/tools/reply.ts")
const { default: editBoard } = await import("../../server/mcp/tools/edit_board.ts")
const { default: viewBoard } = await import("../../server/mcp/tools/view_board.ts")
const { default: commentsGet } = await import("../../server/api/drops/[id]/comments.get.ts")
const { default: commentsPost } = await import("../../server/api/drops/[id]/comments.post.ts")
const { default: uploadPut } = await import("../../server/api/uploads/[ticket].put.ts")
const { default: uploadFile } = await import("../../server/api/files.post.ts")

const MIB = 1024 * 1024

migrate()
beforeEach(() => {
  reset()
  state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
})

// Through a real MCP handler, so each input schema validates the call the way clients see it.
const server = createMcpHandler({
  name: "drop-test",
  version: "1",
  origin: false,
  tools: [publish, readDrop, readFile, reply, listDrops, updateDrop, editBoard, viewBoard],
})
async function call(tool, input, protocolVersion = "2025-06-18") {
  const request = new H3Event(
    new Request("https://drop.example/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": protocolVersion,
        "mcp-method": "tools/call",
        "mcp-name": tool.name,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: tool.name,
          arguments: input,
          ...(protocolVersion === "2026-07-28"
            ? {
                _meta: {
                  "io.modelcontextprotocol/protocolVersion": protocolVersion,
                  "io.modelcontextprotocol/clientInfo": { name: "file-test", version: "1" },
                  "io.modelcontextprotocol/clientCapabilities": {},
                },
              }
            : {}),
        },
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

test("read_drop delivers a person's private upload as image bytes to their agent", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  )
  state.who = who
  const form = new FormData()
  form.set("file", new File([png], "screenshot.png", { type: "image/png" }))
  const event = new H3Event(new Request("https://drop.example/api/files", { method: "POST", body: form }))
  event.context.log = { set() {}, error() {}, warn() {} }
  const uploaded = await uploadFile(event)
  assert.equal(uploaded.share, "private")
  state.who = { ...who, actorKind: "agent", actorName: "Executor" }
  const read = await call(readDrop, { id: uploaded.page })
  assert.deepEqual(
    read.content.find((block) => block.type === "image"),
    {
      type: "image",
      mimeType: "image/png",
      data: png.toString("base64"),
    },
  )
  assert.equal(read.structuredContent.share, "private")
  assert.deepEqual((await call(readFile, { id: uploaded.id })).content[0], read.content[1])
  const raw = await call(readFile, { id: uploaded.id, format: "resource" })
  assert.equal(raw.content[0].type, "resource")
  assert.equal(raw.content[0].resource.blob, png.toString("base64"))
  assert.equal(raw.structuredContent.size, png.length)
  assert.doesNotMatch(raw.content[0].resource.uri, /\/f\//)
})

test("MCP file retrieval rejects other users and anonymous callers before touching storage", async () => {
  insertDrop("private", { visibility: "private", kind: "image", content_type: "image/png" })
  for (const caller of [{ ...who, userId: "other", actorKind: "agent" }, null]) {
    state.who = caller
    for (const tool of [readDrop, readFile]) {
      const before = calls.get
      assert.equal((await call(tool, { id: "private" })).isError, true)
      assert.equal(calls.get, before)
    }
  }
  state.who = { ...who, actorKind: "agent" }
  for (const id of ["absent", "private.md", "https://drop.example/f/private.md"]) {
    assert.match((await call(readFile, { id })).message, /File not found/)
  }
  assert.match((await call(readFile, { id: "private", path: "private.md" })).message, /File not found/)
})

test("image and blob resource blocks survive modern and legacy MCP serialization without duplicating base64 in metadata", async () => {
  insertDrop("image", { visibility: "private", kind: "image", content_type: "image/png" })
  for (const protocol of ["2025-03-26", "2025-11-25", "2026-07-28"]) {
    for (const format of ["auto", "resource"]) {
      const result = await call(readFile, { id: "image", format }, protocol)
      assert.notEqual(result.isError, true, result.message)
      const encoded = format === "auto" ? result.content[0].data : result.content[0].resource.blob
      assert.equal(Buffer.from(encoded, "base64").toString(), "# Source")
      assert.doesNotMatch(JSON.stringify(result.structuredContent), /base64|blob|data/)
    }
  }
})

test("file reads preserve team and public grants, revocation, expiry and owner Trash access", async () => {
  insertDrop("folder", { kind: "folder", blob_key: null, visibility: "team" })
  insertDrop("child", { parent_id: "folder", visibility: "private", kind: "image", content_type: "image/png" })
  state.mode = "team"
  state.who = { ...who, userId: "teammate", actorKind: "agent" }
  assert.equal((await call(readFile, { id: "child" })).content[0].type, "image")
  state.mode = "personal"
  assert.equal((await call(readFile, { id: "child" })).isError, true, "team-mode grant does not include outsiders")
  sql.prepare("UPDATE drops SET share = 'public' WHERE id = 'folder'").run()
  assert.equal((await call(readFile, { id: "child" })).content[0].type, "image")
  sql.prepare("UPDATE drops SET trashed_at = ?, trash_reason = 'user' WHERE id = 'folder'").run(Date.now())
  assert.equal((await call(readFile, { id: "child" })).isError, true, "Trash revokes the inherited public share")
  state.who = { ...who, actorKind: "agent" }
  assert.equal((await call(readFile, { id: "child" })).content[0].type, "image", "owner may still read their Trash")
  sql.prepare("UPDATE drops SET trashed_at = NULL, trash_reason = NULL, last_accessed_at = 1 WHERE id = 'folder'").run()
  state.who = { ...who, userId: "teammate", actorKind: "agent" }
  assert.equal((await call(readFile, { id: "child" })).isError, true, "natural expiry also revokes inherited shares")
  state.who = { ...who, actorKind: "agent" }
  assert.equal((await call(readFile, { id: "child" })).content[0].type, "image")
  sql.prepare("DELETE FROM drops WHERE id = 'child'").run()
  assert.match((await call(readFile, { id: "child" })).message, /File not found/)
})

test("quarantine, owner bans and missing blobs never return private bytes", async () => {
  insertDrop("file", { visibility: "private", kind: "image", content_type: "image/png" })
  sql.prepare("UPDATE drops SET quarantined_at = ? WHERE id = 'file'").run(Date.now())
  assert.equal((await call(readFile, { id: "file" })).isError, true)
  assert.equal(calls.get, 0)
  sql.prepare("UPDATE drops SET quarantined_at = NULL WHERE id = 'file'").run()
  sql.prepare("UPDATE user SET banned = 1 WHERE id = 'owner'").run()
  assert.equal((await call(readFile, { id: "file" })).isError, true)
  assert.equal(calls.get, 0)
  sql.prepare("UPDATE user SET banned = 0 WHERE id = 'owner'").run()
  objects.clear()
  assert.match((await call(readFile, { id: "file" })).message, /File not found/)
})

test("PDF, video, SVG and unknown files are complete embedded resources, never claimed as decoded images", async () => {
  for (const [name, mime, bytes] of [
    ["doc.pdf", "application/pdf", Buffer.from("%PDF-1.7\noriginal bytes")],
    ["clip.mp4", "video/mp4", Buffer.from([0, 0, 0, 24, 102, 116, 121, 112])],
    ["vector.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["data.bin", "application/octet-stream", Buffer.from([0, 255, 128, 17])],
  ]) {
    insertDrop(name, {
      visibility: "private",
      kind: "file",
      filename: name,
      blob_key: name,
      content_type: mime,
      size: bytes.length,
    })
    objects.set(name, { body: new Blob([bytes]) })
    const read = await call(readFile, { id: name })
    assert.equal(read.content[0].type, "resource")
    assert.equal(read.content[0].resource.mimeType, mime)
    assert.deepEqual(Buffer.from(read.content[0].resource.blob, "base64"), bytes)
    assert.equal(read.structuredContent.size, bytes.length)
    const dropRead = await call(readDrop, { id: name })
    assert.deepEqual(
      dropRead.content.find((block) => block.type === "resource"),
      read.content[0],
      "existing read_drop clients receive binary bytes without refreshing their tool catalog",
    )
  }
})

test("file size checks bound both metadata and the stored object before encoding", async () => {
  insertDrop("large", { visibility: "private", size: 4 * MIB + 1 })
  assert.match((await call(readFile, { id: "large" })).message, /4 MiB/)
  assert.equal(calls.get, 0)
  sql.prepare("UPDATE drops SET size = 1 WHERE id = 'large'").run()
  objects.set("large.md", {
    body: {
      size: 4 * MIB + 1,
      arrayBuffer() {
        assert.fail("oversized object was read")
      },
    },
  })
  assert.match((await call(readFile, { id: "large" })).message, /4 MiB/)
  objects.set("large.md", { body: new Blob([new Uint8Array(4 * MIB)]) })
  const result = await call(readFile, { id: "large" })
  assert.equal(Buffer.from(result.content[0].resource.blob, "base64").length, 4 * MIB)
})

test("an app file is resolved within its authorized drop, never by an arbitrary asset key", async () => {
  insertDrop("app", { visibility: "private", kind: "app", blob_key: null })
  insertDrop("other-app", { visibility: "private", kind: "app", blob_key: null })
  sql
    .prepare(
      "INSERT INTO drop_files (drop_id, path, blob_key, size) VALUES ('app', 'assets/a.png', 'apps/app/a.png', 3), ('other-app', 'secret.pdf', 'apps/other/secret.pdf', 6)",
    )
    .run()
  objects.set("apps/app/a.png", { body: new Blob([new Uint8Array([1, 2, 3])]) })
  const read = await call(readFile, { id: "app", path: "assets/a.png" })
  assert.equal(read.content[0].type, "image")
  assert.equal(read.content[0].data, "AQID")
  for (const path of [
    undefined,
    "secret.pdf",
    "apps/other/secret.pdf",
    "../other/secret.pdf",
    "https://elsewhere.example/f/a.png",
  ]) {
    const before = calls.get
    assert.match((await call(readFile, { id: "app", path })).message, /File not found/)
    assert.equal(calls.get, before)
  }
})

test("successful file reads refresh activity and count agent views, but never revive Trash", async () => {
  const old = Date.now() - 3 * 86400000
  insertDrop("pdf", { visibility: "private", kind: "file", content_type: "application/pdf", last_accessed_at: old })
  await call(readFile, { id: "pdf" })
  assert.ok(sql.prepare("SELECT last_accessed_at AS at FROM drops WHERE id = 'pdf'").get().at > old)
  assert.equal(sql.prepare("SELECT sum(views) AS n FROM drop_views WHERE link = 'pdf' AND viewer = 'agent'").get().n, 1)
  sql.prepare("UPDATE drops SET trashed_at = ?, last_accessed_at = ? WHERE id = 'pdf'").run(Date.now(), old)
  await call(readFile, { id: "pdf" })
  assert.equal(sql.prepare("SELECT last_accessed_at AS at FROM drops WHERE id = 'pdf'").get().at, old)
  assert.equal(sql.prepare("SELECT sum(views) AS n FROM drop_views WHERE link = 'pdf' AND viewer = 'agent'").get().n, 1)
})

test("unknown app binaries have a binary MIME fallback", async () => {
  insertDrop("app", { visibility: "private", kind: "app", blob_key: null })
  sql
    .prepare(
      "INSERT INTO drop_files (drop_id, path, blob_key, size) VALUES ('app', 'payload.custombinary', 'apps/payload', 3)",
    )
    .run()
  objects.set("apps/payload", { body: new Blob([new Uint8Array([0, 255, 128])]) })
  const result = await call(readFile, { id: "app", path: "payload.custombinary" })
  assert.equal(result.content[0].resource.mimeType, "application/octet-stream")
  assert.equal(result.content[0].resource.blob, "AP+A")
})

test("publish asks for one kind of content and a lifetime on new drops", async () => {
  assert.match((await call(publish, { note: "x", lifetime: "review" })).message, /exactly one/)
  assert.match(
    (await call(publish, { markdown: "# A", html: "<p>", note: "x", lifetime: "review" })).message,
    /exactly one/,
  )
  assert.match((await call(publish, { markdown: "# A", note: "x" })).message, /lifetime/)
  assert.match((await call(publish, { markdown: "# A", note: "x", lifetime: "keep" })).message, /keepReason/)
})

test("an agent publishes a screenshot and a shared doc that embeds it, then the next version resolves comments", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64")
  const shot = (
    await call(publish, { file: { name: "before.png", base64: png }, note: "Before", lifetime: "temporary" })
  ).structuredContent
  assert.equal(shot.kind, "image")
  assert.equal(
    (await call(readDrop, { id: shot.id })).content[1].data,
    png,
    "agent-created private images use the same path",
  )
  assert.match(shot.fileUrl, /^https:\/\/drop\.example\/f\/[0-9a-f-]{36}\.png$/)

  const doc = (
    await call(publish, {
      markdown: `# Evidence\n\n![before](${shot.fileUrl})`,
      note: "PR evidence",
      lifetime: "keep",
      keepReason: "Screenshots for vite-hub/drop#12.",
      share: "public",
    })
  ).structuredContent
  assert.equal(doc.share, "public")
  assert.equal(doc.lifetime, "keep")
  assert.equal(doc.keepReason, "Screenshots for vite-hub/drop#12.")

  sql
    .prepare(
      "INSERT INTO comments (id, drop_id, n, kind, selector, ox, oy, ow, oh, label, body, author_name, created_at) VALUES ('c1', ?, 1, 'image', 'img', 100, 200, 300, 150, 'img \"before\"', 'Crop this', 'Ada', 1)",
    )
    .run(doc.id)
  const read = await call(readDrop, { id: doc.id })
  assert.equal(read.structuredContent.attachments.length, 1, "the screenshot belongs to the doc")
  assert.match(read.structuredContent.comments[0].target, /area 10%–40% across, 20%–35% down/)
  assert.equal(read.structuredContent.versions[0].note, "PR evidence")

  const next = (
    await call(publish, {
      previous: doc.id,
      markdown: `# Evidence\n\n![before](${shot.fileUrl})`,
      note: "Cropped",
      resolves: [1, 9],
    })
  ).structuredContent
  assert.equal(next.version, 2)
  assert.deepEqual(next.resolved, [1])
  assert.equal(next.lifetime, "keep", "the next version keeps the lifetime")
  assert.equal(next.share, "public")
  assert.equal(sql.prepare("SELECT resolved FROM comments WHERE id = 'c1'").get().resolved, 1)

  const listed = (await call(listDrops, {})).structuredContent
  assert.deepEqual(
    listed.drops.map((drop) => drop.id),
    [next.id],
    "the screenshot hides behind its doc",
  )
})

test("open comments follow a doc to its next versions, numbered across them, and resolve from any later version", async () => {
  const route = (id, init) => {
    const event = new H3Event(
      new Request(
        `https://drop.example/api/drops/${id}/comments`,
        init && { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(init) },
      ),
    )
    event.context.log = { set() {}, error() {} }
    event.context.params = { id }
    return event
  }
  const v1 = (await call(publish, { markdown: "# Plan\n\nShip it on Friday.", note: "Draft", lifetime: "review" }))
    .structuredContent
  await commentsPost(route(v1.id, { kind: "text", selector: "p", ox: 0, oy: 0, quote: "Friday", body: "Too soon?" }))
  const v2 = (await call(publish, { previous: v1.id, markdown: "# Plan\n\nShip it on Monday.", note: "Move the date" }))
    .structuredContent

  const added = await commentsPost(
    route(v2.id, { kind: "text", selector: "p", ox: 0, oy: 0, quote: "Monday", body: "Better" }),
  )
  assert.equal(added.n, 2, "numbers continue across versions")
  assert.equal(added.version, 2)
  assert.deepEqual(
    (await commentsGet(route(v2.id))).map((comment) => [comment.n, comment.version]),
    [
      [1, 1],
      [2, 2],
    ],
  )
  assert.deepEqual(
    (await commentsGet(route(v1.id))).map((comment) => comment.n),
    [1],
    "an older version doesn't see later comments",
  )

  const read = await call(readDrop, { id: v2.id })
  assert.deepEqual(
    read.structuredContent.comments.map((comment) => comment.version),
    [1, 2],
  )
  assert.match(read.content[0].text, /Too soon\? \(Owner, on v1\)/)

  const v3 = (
    await call(publish, {
      previous: v2.id,
      markdown: "# Plan\n\nShip it on Monday, after QA.",
      note: "QA first",
      resolves: [1, 2],
    })
  ).structuredContent
  assert.deepEqual(v3.resolved, [1, 2])
  assert.deepEqual(
    sql
      .prepare("SELECT n, resolved FROM comments ORDER BY n")
      .all()
      .map((row) => [row.n, row.resolved]),
    [
      [1, 1],
      [2, 1],
    ],
  )
})

test("a comment on the whole page points at nothing in it, and agents read it as the whole page", async () => {
  const route = (id, init) => {
    const event = new H3Event(
      new Request(
        `https://drop.example/api/drops/${id}/comments`,
        init && { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(init) },
      ),
    )
    event.context.log = { set() {}, error() {} }
    event.context.params = { id }
    return event
  }
  const doc = (await call(publish, { markdown: "# Plan\n\nShip it on Friday.", note: "Draft", lifetime: "review" }))
    .structuredContent
  const added = await commentsPost(
    route(doc.id, { kind: "page", selector: "", ox: 0, oy: 0, body: "The whole plan reads too long." }),
  )
  assert.equal(added.kind, "page")
  await assert.rejects(
    commentsPost(route(doc.id, { kind: "page", selector: "p", ox: 0, oy: 0, body: "Pointing at a paragraph" })),
    "a page comment can't carry an anchor",
  )

  const read = await call(readDrop, { id: doc.id })
  assert.match(read.content[0].text, /1\. \[the whole page\]\n {3}The whole plan reads too long\. \(Owner\)/)
})

test("a comment inside an element with an id says which section it's in, so a prototype's comments name their variant", async () => {
  const route = (id, init) => {
    const event = new H3Event(
      new Request(`https://drop.example/api/drops/${id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(init),
      }),
    )
    event.context.log = { set() {}, error() {} }
    event.context.params = { id }
    return event
  }
  const html = `<!doctype html><title>Hero</title><body><section id="v-prism" data-variant="Prism"><h1>Plan demand</h1></section><section id="v-glyphs" data-variant="Glyphs"><h1>Plan demand</h1></section></body>`
  const page = (await call(publish, { html, note: "Which hero?", lifetime: "temporary" })).structuredContent
  await commentsPost(
    route(page.id, { kind: "text", selector: "#v-prism > h1", ox: 0, oy: 0, quote: "Plan demand", body: "Too quiet." }),
  )
  await commentsPost(
    route(page.id, {
      kind: "area",
      selector: "#v-glyphs",
      label: 'section "Plan demand"',
      ox: 0,
      oy: 0,
      ow: 1000,
      oh: 500,
      body: "Keep this one.",
    }),
  )
  await commentsPost(
    route(page.id, { kind: "text", selector: "body > p", ox: 0, oy: 0, quote: "Plan", body: "No id above it." }),
  )

  const { text } = (await call(readDrop, { id: page.id })).content[0]
  assert.match(text, /1\. > Plan demand \(in #v-prism\)\n {3}Too quiet\./)
  assert.match(
    text,
    /2\. \[the area 0%–100% across, 0%–50% down of section "Plan demand"\] \(in #v-glyphs\)\n {3}Keep this one\./,
  )
  assert.match(text, /3\. > Plan\n {3}No id above it\./)
})

test("a comment carried to v2 takes replies; the agent answers in the thread and reads it back", async () => {
  const route = (id, init) => {
    const event = new H3Event(
      new Request(
        `https://drop.example/api/drops/${id}/comments`,
        init && { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(init) },
      ),
    )
    event.context.log = { set() {}, error() {} }
    event.context.params = { id }
    return event
  }
  const v1 = (await call(publish, { markdown: "# Plan\n\nShip it on Friday.", note: "Draft", lifetime: "review" }))
    .structuredContent
  await commentsPost(route(v1.id, { kind: "text", selector: "p", ox: 0, oy: 0, quote: "Friday", body: "Why Friday?" }))
  const v2 = (
    await call(publish, { previous: v1.id, markdown: "# Plan\n\nShip it on Friday, after QA.", note: "QA first" })
  ).structuredContent

  // #1 was written on v1; the thread still takes a reply through v2's chain.
  const answered = await call(reply, {
    id: v2.id,
    comment: 1,
    body: "QA signs off Thursday, so Friday is the first free day.",
  })
  assert.equal(answered.structuredContent.comment, 1)
  assert.equal(answered.structuredContent.reply.authorName, "Owner")
  assert.equal((await call(reply, { id: v2.id, comment: 9, body: "Nope" })).isError, true, "a missing number fails")

  const [listed] = await commentsGet(route(v2.id))
  assert.deepEqual(
    listed.replies.map((item) => item.body),
    ["QA signs off Thursday, so Friday is the first free day."],
  )
  const read = await call(readDrop, { id: v2.id })
  assert.match(read.content[0].text, /Why Friday\? \(Owner, on v1\)\n {3}↳ Owner: QA signs off Thursday/)
  assert.equal(read.structuredContent.comments[0].replies.length, 1)

  // Deleting the comment takes its thread with it.
  sql.prepare("DELETE FROM comments").run()
  assert.equal(sql.prepare("SELECT count(*) AS n FROM comment_replies").get().n, 0)
})

test("update_drop shares, trashes, and restores; the Trash lists separately", async () => {
  const doc = (await call(publish, { markdown: "# Plan", note: "Draft", lifetime: "review" })).structuredContent
  assert.equal(
    (await call(updateDrop, { id: doc.id, share: "public_comment" })).structuredContent.share,
    "public_comment",
  )
  assert.match(
    (await call(updateDrop, { id: doc.id, trash: true })).structuredContent.status,
    /^In the Trash, deleting in 15 days$/,
  )
  assert.deepEqual((await call(listDrops, {})).structuredContent.drops, [])
  assert.equal((await call(listDrops, { trash: true })).structuredContent.drops[0].id, doc.id)
  assert.match((await call(updateDrop, { id: doc.id, title: "Renamed" })).message, /Restore it first/)
  assert.equal((await call(updateDrop, { id: doc.id, trash: false })).structuredContent.status, "Expires in 30 days")
})

test("an agent publishes an app, sends only what changed, and hears about missing files", async () => {
  const app = await call(publish, {
    files: {
      "index.html": '<script type="module" src="app.js"></script><img src="logo.png">',
      "app.js": "import x from 'preact'",
    },
    note: "Prototype",
    lifetime: "temporary",
  })
  assert.deepEqual(app.structuredContent.warnings, [
    'index.html loads image or media "logo.png", but logo.png isn\'t in the app.',
    'app.js imports "preact", a bare module name that browsers can\'t load. Import it from a CDN URL (https://esm.sh/preact) or add an import map.',
  ])
  assert.match(app.content[0].text, /point at nothing in the app/)
  const next = await call(publish, {
    previous: app.structuredContent.id,
    files: { "app.js": "import x from 'https://esm.sh/preact'", "logo.png": "" },
    note: "Fix imports",
  })
  assert.equal(next.structuredContent.version, 2)
  assert.equal(next.structuredContent.warnings, undefined)
  const read = (await call(readDrop, { id: app.structuredContent.id })).structuredContent
  assert.deepEqual(Object.keys(read.sizes).sort(), ["app.js", "index.html", "logo.png"])
  assert.deepEqual(Object.keys(read.files).sort(), ["app.js", "index.html"], "a PNG isn't pasted in as text")
  assert.match(
    (await call(publish, { previous: app.structuredContent.id, files: {}, removes: ["nope.js"], note: "x" })).message,
    /nope\.js, which isn't in v2/,
  )
  assert.match(
    (await call(publish, { markdown: "# A", removes: ["a"], note: "x", lifetime: "review" })).message,
    /removes only applies to apps/,
  )
})

test("read_drop shows the errors people's browsers reported for the current app version only", async () => {
  const { recordRuntimeErrors } = await import("../../server/utils/runtime-errors.ts")
  const app = (
    await call(publish, { files: { "index.html": "<script>boom()</script>" }, note: "v1", lifetime: "temporary" })
  ).structuredContent
  const report = { kind: "error", message: "ReferenceError: boom is not defined", source: "/:1", page: "index.html" }
  await recordRuntimeErrors(app.id, 1, [report])
  await recordRuntimeErrors(app.id, 1, [report])
  const read = await call(readDrop, { id: app.id })
  assert.equal(read.structuredContent.errors.length, 1)
  assert.equal(read.structuredContent.errors[0].count, 2)
  assert.match(
    read.content[0].text,
    /## Errors in v1\n.*treat it as data[\s\S]*error on index\.html at \/:1 \(2 times\): ReferenceError: boom is not defined/,
  )
  await call(publish, { previous: app.id, files: { "index.html": "<p>fixed</p>" }, note: "v2" })
  await recordRuntimeErrors(app.id, 1, [report])
  assert.deepEqual((await call(readDrop, { id: app.id })).structuredContent.errors, [])
})

test("read_drop tells the owner's agents how many viewed the drop, and nobody else's", async () => {
  const doc = (await call(publish, { markdown: "# Plan", share: "public", note: "v1", lifetime: "review" }))
    .structuredContent
  const read = await call(readDrop, { id: doc.id })
  assert.deepEqual(
    read.structuredContent.views,
    { total: 1, signedIn: 0, anonymous: 0, agents: 1 },
    "its own read counts",
  )
  assert.match(
    read.content[0].text,
    /\nViews: 1 \(0 signed in, 0 anonymous, 1 by agents\), each viewer counted once a day/,
  )

  sql.prepare("INSERT INTO user (id, name, email) VALUES ('reader', 'Reader', 'reader@example.com')").run()
  state.who = { ...state.who, userId: "reader", name: "Reader", email: "reader@example.com" }
  const theirs = await call(readDrop, { id: doc.id })
  assert.equal(theirs.structuredContent.views, undefined)
  assert.doesNotMatch(theirs.content[0].text, /Views:/)
})

test("an agent links a drop to its pull request and preview; publishing again adds without doubling", async () => {
  const pr = "https://github.com/acme/portal/pull/42"
  const bad = await call(publish, {
    markdown: "# Evidence",
    note: "v1",
    lifetime: "review",
    resources: [{ url: "http://example.com/pr" }],
  })
  assert.match(bad.message, /isn't a link: use https/)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drops").get().n, 0, "nothing is published")

  const doc = (
    await call(publish, {
      markdown: "# Evidence",
      share: "public",
      note: "v1",
      lifetime: "review",
      resources: [{ url: pr, title: "PR #42" }, { url: `${pr}#top` }, { url: pr }],
    })
  ).structuredContent
  const v2 = (
    await call(publish, {
      markdown: "# Evidence 2",
      previous: doc.id,
      note: "v2",
      resources: [{ url: pr }, { url: "https://pr42-demo.preview.quiver.dk", title: "Preview" }],
    })
  ).structuredContent
  const linked = [
    { url: pr, title: "PR #42" },
    { url: `${pr}#top` },
    { url: "https://pr42-demo.preview.quiver.dk/", title: "Preview" },
  ]
  const read = await call(readDrop, { id: v2.id })
  assert.deepEqual(read.structuredContent.resources, linked, "the PR keeps its place and its title")
  assert.match(read.content[0].text, /\nLinks:\n- PR #42: https:\/\/github\.com\/acme\/portal\/pull\/42\n/)
  assert.deepEqual(
    (await call(readDrop, { id: doc.id })).structuredContent.resources,
    linked,
    "every version shows them",
  )

  sql.prepare("INSERT INTO user (id, name, email) VALUES ('reader', 'Reader', 'reader@example.com')").run()
  const agent = state.who
  state.who = { ...agent, userId: "reader", name: "Reader", email: "reader@example.com" }
  assert.deepEqual((await call(readDrop, { id: v2.id })).structuredContent.resources, linked, "anyone who can open it")
  assert.match((await call(updateDrop, { id: v2.id, resources: [] })).message, /No drop/, "only who may publish to it")
  state.who = agent

  const tooMany = Array.from({ length: 6 }, (_, n) => ({ url: `https://example.com/${n}` }))
  assert.match(
    (await call(publish, { markdown: "# 3", previous: v2.id, note: "v3", resources: tooMany })).message,
    /at most 8/,
  )
  const replaced = await call(updateDrop, { id: v2.id, resources: [{ url: "https://linear.app/acme/issue/ACM-7" }] })
  assert.match(replaced.content[0].text, /^Updated, 1 link at the top:/)
  assert.deepEqual((await call(readDrop, { id: v2.id })).structuredContent.resources, [
    { url: "https://linear.app/acme/issue/ACM-7" },
  ])
  await call(updateDrop, { id: v2.id, resources: [] })
  assert.equal((await call(readDrop, { id: v2.id })).structuredContent.resources, undefined)

  await call(updateDrop, { id: v2.id, resources: [{ url: pr }] })
  sql.prepare("DELETE FROM drops WHERE id = ?").run(v2.id)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drop_resources").get().n, 1, "they stay while a version does")
  sql.prepare("DELETE FROM drops WHERE id = ?").run(doc.id)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drop_resources").get().n, 0, "and go with the last one")
})

test("a file without base64 gets an upload URL; curl -T creates the drop once, and a changed ticket does nothing", async () => {
  state.authSecret = "test-secret"
  try {
    assert.equal(
      (await call(publish, { file: { name: "after.png" }, note: "After" })).isError,
      true,
      "the same checks run before a URL is handed out",
    )
    const ticket = (
      await call(publish, {
        file: { name: "after.png" },
        note: "After",
        lifetime: "keep",
        keepReason: "Screenshots for vite-hub/drop#12.",
        share: "public",
      })
    ).structuredContent
    assert.match(ticket.uploadUrl, /^https:\/\/drop\.example\/api\/uploads\/v2\.[\w-]+$/)
    assert.equal(ticket.method, "PUT")
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM drops").get().n, 0, "nothing exists until the upload")

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    state.who = null // curl sends no sign-in; the ticket stands in for it
    const put = (url, body = png) => {
      const event = new H3Event(
        new Request(url, { method: "PUT", body, headers: { "content-length": String(body.length) } }),
      )
      event.context.log = { set() {}, error() {}, warn() {} }
      event.context.params = { ticket: new URL(url).pathname.split("/").pop() }
      return uploadPut(event)
    }
    // Streamed with no length (`curl -T -`), a body over the limit is cut off while it arrives, not read whole first.
    let chunks = 0
    const endless = new ReadableStream({
      pull: (stream) => (chunks++ < 64 ? stream.enqueue(new Uint8Array(MIB)) : stream.close()),
    })
    const streamed = new H3Event(new Request(ticket.uploadUrl, { method: "PUT", body: endless, duplex: "half" }))
    streamed.context.log = { set() {}, error() {}, warn() {} }
    streamed.context.params = { ticket: new URL(ticket.uploadUrl).pathname.split("/").pop() }
    await assert.rejects(
      uploadPut(streamed),
      (error) => error.status === 413 && /exceeds the 4 MiB/.test(error.message),
    )
    assert.ok(chunks < 10, `read ${chunks} MiB`)
    const shot = await put(ticket.uploadUrl)
    assert.equal(shot.kind, "image")
    assert.equal(shot.share, "public")
    assert.equal(shot.lifetime, "keep")
    assert.match(shot.fileUrl, /^https:\/\/drop\.example\/f\/[0-9a-f-]{36}\.png$/)
    assert.equal(
      sql.prepare("SELECT actor_name FROM drops WHERE id = ?").get(shot.id).actor_name,
      "Claude Code",
      "the drop names the agent that asked",
    )

    await assert.rejects(put(ticket.uploadUrl), /already used/)
    const tampered = ticket.uploadUrl.slice(0, -4) + (ticket.uploadUrl.endsWith("AAAA") ? "BBBB" : "AAAA")
    await assert.rejects(put(tampered), /run out or isn't valid/)
  } finally {
    state.authSecret = undefined
  }
})

test("a built app goes up as one archive, binary files and all, and its next archive replaces every file", async () => {
  state.authSecret = "test-secret"
  try {
    assert.match(
      (await call(publish, { archive: {}, note: "x", lifetime: "temporary" })).message,
      /needs an origin of its own/,
    )
    state.contentOrigin = "https://*-drop.example"
    assert.match(
      (await call(publish, { archive: {}, removes: ["a.js"], note: "x", lifetime: "temporary" })).message,
      /leave removes out/,
    )
    const ticket = (await call(publish, { archive: {}, slug: "site", note: "Build", lifetime: "temporary" }))
      .structuredContent
    assert.match(ticket.uploadUrl, /\/api\/uploads\/v2\./)
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM drops").get().n, 0, "nothing exists until the upload")

    state.who = null
    const put = (url, body) => {
      const event = new H3Event(new Request(url, { method: "PUT", body }))
      event.context.log = { set() {}, error() {}, warn() {} }
      event.context.params = { ticket: new URL(url).pathname.split("/").pop() }
      return uploadPut(event)
    }
    const font = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0xff, 0x00, 0xfe, 0x80])
    const archive = await createTarGzip([
      { name: "dist/" },
      {
        name: "dist/index.html",
        data: '<link rel="stylesheet" href="/_nuxt/app.css"><script type="module" src="/_nuxt/entry.js"></script>',
      },
      { name: "dist/_nuxt/entry.js", data: 'import("./lazy.js")' },
      { name: "dist/_nuxt/lazy.js", data: "export default 1" },
      { name: "dist/_nuxt/app.css", data: "@font-face{src:url(./inter.woff2)}" },
      { name: "dist/_nuxt/inter.woff2", data: font },
      { name: "dist/._index.html", data: "junk" },
    ])
    const app = await put(ticket.uploadUrl, archive)
    assert.equal(app.kind, "app")
    assert.equal(app.warnings, undefined, "every reference resolves")
    const rows = sql.prepare("SELECT path, blob_key, size FROM drop_files WHERE drop_id = ? ORDER BY path").all(app.id)
    assert.deepEqual(
      rows.map((row) => row.path),
      ["_nuxt/app.css", "_nuxt/entry.js", "_nuxt/inter.woff2", "_nuxt/lazy.js", "index.html"],
      "the lone top folder and macOS junk are left out",
    )
    const stored = new Uint8Array(
      await objects.get(rows.find((row) => row.path.endsWith(".woff2")).blob_key).body.arrayBuffer(),
    )
    assert.deepEqual(stored, font, "binary files keep their bytes")

    state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
    const next = (await call(publish, { archive: {}, previous: app.id, note: "Rebuild" })).structuredContent
    state.who = null
    const v2 = await put(next.uploadUrl, await createTarGzip([{ name: "./index.html", data: "<p>v2</p>" }]))
    assert.equal(v2.version, 2)
    const after = sql.prepare("SELECT path, blob_key FROM drop_files WHERE drop_id = ?").all(app.id)
    assert.deepEqual(
      after.map((row) => row.path),
      ["index.html"],
      "files missing from the archive leave the app",
    )
    for (const row of rows) assert.equal(objects.has(row.blob_key), false, "and their blobs are deleted")

    state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
    const empty = (await call(publish, { archive: {}, previous: app.id, note: "x" })).structuredContent
    await assert.rejects(put(empty.uploadUrl, await createTarGzip([{ name: "app.js", data: "1" }])), /index\.html/)
  } finally {
    state.authSecret = undefined
    state.contentOrigin = undefined
  }
})

test("tools/list publishes every tool's input schema", async () => {
  // One schema that can't become JSON Schema (v.trim(), say) fails tools/list, and with it every client's connection.
  const dir = new URL("../../server/mcp/tools/", import.meta.url)
  const tools = await Promise.all(
    readdirSync(dir)
      .filter((file) => file.endsWith(".ts"))
      .map(async (file) => (await import(new URL(file, dir).href)).default),
  )
  const all = createMcpHandler({ name: "drop-test", version: "1", origin: false, tools })
  const request = new H3Event(
    new Request("https://drop.example/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
  )
  request.context.log = { set() {}, error() {}, warn() {} }
  const text = await (await toResponse(await all(request), request)).text()
  const body = JSON.parse(text.startsWith("{") ? text : text.match(/^data: (.+)$/m)[1])
  assert.equal(body.error, undefined, body.error?.message)
  assert.deepEqual(body.result.tools.map((tool) => tool.name).sort(), tools.map((tool) => tool.name).sort())
})

test("an agent publishes a board, reads its outline, and edits it", async () => {
  const board = (
    await call(publish, {
      board: {
        items: [
          { id: "flow", type: "frame", text: "Onboarding flow" },
          { id: "signup", type: "note", text: "Sign up", in: "flow" },
          { id: "team", type: "note", text: "Pick a team", in: "flow" },
        ],
        edges: [{ from: "signup", to: "team", label: "invite?" }],
      },
      title: "Onboarding",
      note: "First sketch",
      lifetime: "review",
    })
  ).structuredContent
  assert.equal(board.kind, "board")

  const read = await call(readDrop, { id: board.id })
  const outline = read.content[0].text
  assert.match(outline, /frame flow "Onboarding flow" .* by Claude Code/)
  assert.match(outline, /arrow \S+: signup "Sign up" → team "Pick a team" "invite\?"/)

  const edited = await call(editBoard, {
    id: board.id,
    add: [{ id: "solo", type: "note", text: "Solo users skip this", in: "flow", color: "green" }],
    update: [{ id: "team", text: "Pick or create a team" }],
  })
  assert.match(edited.content[0].text, /note solo "Solo users skip this"/)
  assert.match(edited.content[0].text, /note team "Pick or create a team"/)
  assert.match(
    (await call(editBoard, { id: board.id, add: [{ id: "x", type: "note", in: "nope" }] })).message,
    /"nope"/,
  )

  // No browser has rendered it yet, so there's no image; the answer says how to get one.
  assert.match((await call(viewBoard, { id: board.id })).content[0].text, /No image yet/)

  // Once a browser has sent its renders, the agent sees the whole board, or one frame by its id.
  const { findDrop } = await import("../../server/utils/drops.ts")
  const { storeBoardImages } = await import("../../server/utils/boards.ts")
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
  await storeBoardImages(await findDrop(board.id), [
    { frame: "overview", png },
    { frame: "flow", png },
    { frame: "not-a-frame", png },
  ])
  const whole = await call(viewBoard, { id: board.id })
  assert.deepEqual(whole.content[0], { type: "image", data: png, mimeType: "image/png" })
  assert.match(whole.content[1].text, /The whole board\. Frames: flow "Onboarding flow"/)
  assert.equal((await call(viewBoard, { id: board.id, frame: "flow" })).content[0].type, "image")
  assert.match((await call(viewBoard, { id: board.id, frame: "nope" })).message, /No frame nope\. Frames: flow/)
  // Search finds a board by the words on it.
  assert.match((await call(listDrops, { query: "create a team" })).content[0].text, /Onboarding/)

  // A next version that doesn't name itself keeps the board's title instead of becoming "board".
  const next = (
    await call(publish, {
      previous: board.id,
      board: { items: [{ id: "again", type: "note", text: "Second sketch" }] },
      note: "Second sketch",
    })
  ).structuredContent
  assert.equal(next.version, 2)
  assert.equal(next.title, "Onboarding")
})
