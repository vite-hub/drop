import assert from "node:assert/strict"
import { beforeEach, test, vi } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { migrate, objects, reset, sql, state, who } from "../cost/harness.mjs"
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: imagePut } = await import("../../server/api/uploads/images/[ticket].put.ts")
const { default: uploadPut } = await import("../../server/api/uploads/[ticket].put.ts")
const { deleteDrop, deleteExpiredDrops, findDrop } = await import("../../server/utils/drops.ts")
const { drainBlobCleanup } = await import("../../server/utils/drops/write.ts")
const { requireBlobAccess } = await import("../../server/utils/content-access.ts")

migrate()
beforeEach(() => {
  reset()
  state.burstCounts = undefined
  state.authSecret = "test-secret"
  state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
})

const server = createMcpHandler({ name: "drop-test", version: "1", origin: false, tools: [publish] })
async function call(input) {
  input = { note: "Cards", ...input }
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
        params: { name: publish.name, arguments: input },
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

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
function put(route, url, body = png) {
  const event = new H3Event(
    new Request(url, { method: "PUT", body, headers: { "content-length": String(body.length) } }),
  )
  event.context.log = { set() {}, error() {}, warn() {} }
  event.context.params = { ticket: new URL(url).pathname.split("/").pop() }
  return route(event)
}
const upload = (url, body) => put(imagePut, url, body)

const source = async (id) => {
  const row = sql.prepare("SELECT blob_key FROM drops WHERE id = ?").get(id)
  return objects.get(row.blob_key).body.text()
}
const children = (id) =>
  sql.prepare("SELECT id, filename, blob_key, share, lifetime FROM drops WHERE parent_id = ? ORDER BY filename").all(id)

const MARKDOWN = [
  "# Cards",
  "",
  "![First](./A.png)",
  "",
  '::screenshot{src="./B.png" alt="Second"}',
  "::",
  "",
  "![Third](./C.png 'Card three')",
  "",
  "The file `./A.png` stays as written in code, and so does this mention of ./A.png.",
  "",
  "```md",
  "![First](./A.png)",
  "```",
].join("\n")

test("three images give three upload URLs, and ./name in the doc becomes each image's fileUrl", async () => {
  const published = await call({
    markdown: MARKDOWN,
    images: [{ name: "A.png" }, { name: "B.png" }, { name: "C.png" }],
    lifetime: "review",
    share: "public",
  })
  assert.equal(published.isError, undefined, published.message)
  const doc = published.structuredContent
  assert.deepEqual(
    doc.images.map((image) => image.name),
    ["A.png", "B.png", "C.png"],
  )
  for (const image of doc.images) {
    assert.match(image.uploadUrl, /^https:\/\/drop\.example\/api\/uploads\/images\/[\w-]+$/)
    assert.match(image.fileUrl, /^https:\/\/drop\.example\/f\/[0-9a-f-]{36}\.png$/)
    assert.equal(image.method, "PUT")
  }
  assert.match(published.content[0].text, /curl -T <path to A\.png> 'https:\/\/drop\.example\/api\/uploads\/images\//)
  const [a, b, c] = doc.images.map((image) => image.fileUrl)
  assert.equal(
    await source(doc.id),
    MARKDOWN.replace("](./A.png)", `](${a})`).replace('src="./B.png"', `src="${b}"`).replace("](./C.png ", `](${c} `),
    "links and attributes point at the files; inline code, fences, and prose keep ./A.png",
  )
  assert.deepEqual(children(doc.id), [], "nothing exists until an image is uploaded")

  state.who = null // curl sends no sign-in; the ticket stands in for it
  const stored = await Promise.all(doc.images.map((image) => upload(image.uploadUrl)))
  assert.deepEqual(
    stored.map((image) => image.fileUrl),
    [a, b, c],
  )
  const rows = children(doc.id)
  assert.deepEqual(
    rows.map((row) => [row.filename, `https://drop.example/f/${row.blob_key}`]),
    [
      ["A.png", a],
      ["B.png", b],
      ["C.png", c],
    ],
  )
  await assert.rejects(upload(doc.images[0].uploadUrl), /already used/)

  // Anyone who can read the public doc can load its images.
  const reader = new H3Event(new Request(a))
  reader.context.log = { set() {}, error() {}, warn() {} }
  await requireBlobAccess(reader, rows[0].blob_key)
})

test("an upload that isn't an image, or for a doc that's gone, is refused", async () => {
  const doc = (await call({ markdown: "![](./A.png)", images: [{ name: "A.png" }], lifetime: "review" }))
    .structuredContent
  state.who = null
  await assert.rejects(upload(doc.images[0].uploadUrl, Buffer.from("not an image")), /isn't an image/)
  await deleteDrop(await findDrop(doc.id))
  await assert.rejects(upload(doc.images[0].uploadUrl), /is gone/)
})

test("the images live and expire with the doc", async () => {
  const doc = (
    await call({
      markdown: "![](./A.png)\n![](./B.png)",
      images: [{ name: "A.png" }, { name: "B.png" }],
      lifetime: "review",
    })
  ).structuredContent
  state.who = null
  for (const image of doc.images) await upload(image.uploadUrl)
  const keys = children(doc.id).map((row) => row.blob_key)
  assert.equal(keys.length, 2)

  // The doc ages out: its row moves to the trash, and its images go when it's purged.
  const monthAgo = Date.now() - 31 * 86_400_000
  sql.prepare("UPDATE drops SET last_accessed_at = ?, created_at = ? WHERE id = ?").run(monthAgo, monthAgo, doc.id)
  await deleteExpiredDrops(new Date())
  assert.ok(sql.prepare("SELECT trashed_at FROM drops WHERE id = ?").get(doc.id).trashed_at)
  assert.equal(
    sql.prepare("SELECT COUNT(*) AS n FROM drops WHERE parent_id = ? AND trashed_at IS NULL").get(doc.id).n,
    2,
    "the images stay readable through the doc's trash like any attachment",
  )
  await deleteExpiredDrops(new Date(Date.now() + 365 * 86_400_000))
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM drops").get().n, 0)
  for (const key of keys) assert.equal(objects.has(key), false)
})

test("deleting the doc deletes its images", async () => {
  const doc = (await call({ markdown: "![](./A.png)", images: [{ name: "A.png" }], lifetime: "review" }))
    .structuredContent
  state.who = null
  await upload(doc.images[0].uploadUrl)
  const [{ blob_key }] = children(doc.id)
  await deleteDrop(await findDrop(doc.id))
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM drops").get().n, 0)
  assert.equal(objects.has(blob_key), false)
})

test("with previous, ./name finds the images the doc has, and a new A.png replaces the old one", async () => {
  const first = (
    await call({
      markdown: "![](./A.png)\n![](./B.png)",
      images: [{ name: "A.png" }, { name: "B.png" }],
      lifetime: "review",
    })
  ).structuredContent
  const who = state.who
  state.who = null
  await upload(first.images[1].uploadUrl)
  state.who = who

  const text = (await call({ previous: first.id, markdown: "# v2\n\n![](./B.png)", note: "Text only" }))
    .structuredContent
  assert.equal(text.images, undefined)
  assert.equal(await source(first.id), `# v2\n\n![](${first.images[1].fileUrl})`)

  const swapped = (
    await call({
      previous: first.id,
      markdown: "![](./A.png)\n![](./B.png)",
      images: [{ name: "A.png" }],
      note: "New A",
    })
  ).structuredContent
  assert.equal(swapped.images.length, 1)
  assert.notEqual(swapped.images[0].fileUrl, first.images[0].fileUrl)
  assert.equal(await source(first.id), `![](${swapped.images[0].fileUrl})\n![](${first.images[1].fileUrl})`)
  state.who = null
  await upload(swapped.images[0].uploadUrl)
  await upload(first.images[0].uploadUrl)
  state.who = who
  sql
    .prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 205)
    INSERT INTO drops (id, owner_id, kind, title, filename, blob_key, parent_id, parent_version, created_at, updated_at, actor_kind, actor_name)
    SELECT 'filler-' || i, ?, 'image', 'Filler', 'filler-' || i || '.png', 'filler-' || i || '.png', ?, 3, ?, ?, 'agent', 'test' FROM n
  `)
    .run(who.userId, first.id, Date.now() + 1000, Date.now() + 1000)
  const again = (await call({ previous: first.id, markdown: "![](./A.png)\n![](./B.png)", note: "Latest A, old B" }))
    .structuredContent
  assert.equal(await source(again.id), `![](${swapped.images[0].fileUrl})\n![](${first.images[1].fileUrl})`)
})

test("a Markdown file uploaded with curl gets its images' upload URLs in the reply", async () => {
  const ticket = (
    await call({ file: { name: "plan.md" }, images: [{ name: "A.png" }], lifetime: "review", note: "Plan" })
  ).structuredContent
  state.who = null
  const doc = await put(uploadPut, ticket.uploadUrl, Buffer.from("![](./A.png)"))
  assert.equal(doc.images.length, 1)
  assert.equal(await source(doc.id), `![](${doc.images[0].fileUrl})`)
  await upload(doc.images[0].uploadUrl)
  assert.equal(children(doc.id).length, 1)
})

test("rewrites parsed destinations without touching quoted prose, titles or nested code", async () => {
  const markdown = [
    'The old location was "./old.png".',
    "",
    '![card]( ./A.png "./title.png")',
    "",
    "> ```md",
    "> ![](./old.png)",
    "> ```",
    "",
    "    ![](./old.png)",
    "",
    "[unused]: <./A.png>",
    "",
    '::screenshot{src=./A.png alt="./old.png"}',
    "::",
  ].join("\n")
  const result = await call({ markdown, images: [{ name: "A.png" }], lifetime: "review" })
  assert.equal(result.isError, undefined, result.message)
  const {
    id,
    images: [{ fileUrl }],
  } = result.structuredContent
  assert.equal(await source(id), markdown.replaceAll("./A.png", fileUrl))
})

test("rejects an oversized sealed Markdown manifest before issuing an upload URL", async () => {
  const images = Array.from({ length: 30 }, (_, index) => ({ name: `${index}${"图".repeat(94)}.png` }))
  const result = await call({ file: { name: "plan.md" }, images, lifetime: "review" })
  assert.equal(result.isError, true)
  assert.match(result.message, /shorten.*names/i)
})

test("all 30 uploads fit one owner window, but an additional image is rate limited", async () => {
  state.burstCounts = new Map()
  const images = Array.from({ length: 30 }, (_, index) => ({ name: `card-${index}.png` }))
  const doc = (await call({ markdown: "# Cards", images, lifetime: "review" })).structuredContent
  const next = (await call({ markdown: "# Extra", images: [{ name: "extra.png" }], lifetime: "review" }))
    .structuredContent
  state.who = null
  for (const image of doc.images) await upload(image.uploadUrl)
  assert.equal(children(doc.id).length, 30)
  await assert.rejects(upload(next.images[0].uploadUrl), { status: 429 })
})

test("only supported filename extensions get tickets; each accepts its matching image bytes", async () => {
  const formats = new Map([
    ["a.png", png],
    ["a.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xdb])],
    ["a.jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xdb])],
    ["a.gif", Buffer.from("GIF89a")],
    ["a.webp", Buffer.from("RIFF\0\0\0\0WEBP")],
  ])
  for (const name of ["a.svg", "a.avif"]) {
    const result = await call({ markdown: `![](./${name})`, images: [{ name }], lifetime: "review" })
    assert.equal(result.isError, true)
    assert.match(result.message, /Convert other formats/)
  }
  const doc = (
    await call({ markdown: "# Formats", images: Array.from(formats.keys(), (name) => ({ name })), lifetime: "review" })
  ).structuredContent
  state.who = null
  await assert.rejects(upload(doc.images[1].uploadUrl, png), { status: 415 })
  for (const image of doc.images) await upload(image.uploadUrl, formats.get(image.name))
  assert.equal(children(doc.id).length, formats.size)
})

test("Markdown upload preserves the existing invalid UTF-8 error", async () => {
  const first = (await call({ markdown: "# Cards", lifetime: "review" })).structuredContent
  const file = { name: "plan.md" }
  const withImages = (await call({ file, images: [{ name: "A.png" }], lifetime: "review" })).structuredContent
  const revision = (await call({ file, previous: first.id })).structuredContent
  state.who = null
  for (const { uploadUrl } of [withImages, revision]) {
    await assert.rejects(put(uploadPut, uploadUrl, Buffer.from([0x80])), {
      status: 400,
      statusText: "Text files must contain valid UTF-8.",
    })
  }
})

test("a failed attachment insert deletes the blob and allows the URL to be retried", async () => {
  const doc = (await call({ markdown: "![](./A.png)", images: [{ name: "A.png" }], lifetime: "review" }))
    .structuredContent
  const { uploadUrl, fileUrl } = doc.images[0]
  const key = new URL(fileUrl).pathname.split("/").pop()
  state.who = null
  sql.exec(`CREATE TRIGGER fail_doc_image BEFORE INSERT ON drops WHEN NEW.kind = 'image'
    BEGIN SELECT RAISE(ABORT, 'injected image insert failure'); END;`)
  try {
    await assert.rejects(upload(uploadUrl), /injected image insert failure/)
    assert.equal(objects.has(key), false)
    assert.equal(children(doc.id).length, 0)
  } finally {
    sql.exec("DROP TRIGGER fail_doc_image")
  }
  await upload(uploadUrl)
  assert.equal(objects.has(key), true)
  assert.equal(children(doc.id).length, 1)
})

test("queued image cleanup cannot race a successful upload retry", async () => {
  const doc = (await call({ markdown: "![](./A.png)", images: [{ name: "A.png" }], lifetime: "review" }))
    .structuredContent
  const { uploadUrl, fileUrl, expiresAt } = doc.images[0]
  const key = new URL(fileUrl).pathname.split("/").pop()
  state.who = null
  const remove = state.blob.delete
  const deletionStarted = Promise.withResolvers()
  const resumeDeletion = Promise.withResolvers()
  const deletion = vi.spyOn(state.blob, "delete").mockImplementationOnce(async () => [new Error("delete failed")])
  let drain
  let clock
  try {
    sql.exec(`CREATE TRIGGER fail_doc_image BEFORE INSERT ON drops WHEN NEW.kind = 'image'
      BEGIN SELECT RAISE(ABORT, 'injected image insert failure'); END;`)
    try {
      await assert.rejects(upload(uploadUrl), /injected image insert failure/)
    } finally {
      sql.exec("DROP TRIGGER fail_doc_image")
    }
    assert.equal(objects.has(key), true)
    deletion.mockImplementationOnce(async (keys) => {
      deletionStarted.resolve()
      await resumeDeletion.promise
      return remove(keys)
    })
    drain = drainBlobCleanup()
    await Promise.race([drain, deletionStarted.promise])
    await assert.rejects(upload(uploadUrl), { status: 409, statusText: /Publish the doc with previous and images/ })
    assert.equal(deletion.mock.calls.length, 1, "cleanup must wait until the ticket expires")
    assert.equal(children(doc.id).length, 0)

    clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(expiresAt))
    drain = drainBlobCleanup()
    await Promise.race([drain, deletionStarted.promise])
    assert.equal(deletion.mock.calls.length, 2, "expired cleanup is eligible to run")
    await assert.rejects(upload(uploadUrl), { status: 403 })

    state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
    const replacement = (await call({ markdown: "![](./A.png)", previous: doc.id, images: [{ name: "A.png" }] }))
      .structuredContent.images[0]
    state.who = null
    await upload(replacement.uploadUrl)
    resumeDeletion.resolve()
    await drain
    assert.equal(objects.has(key), false)
    assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM blob_cleanup").get().n, 0)
    assert.equal(objects.has(children(doc.id)[0].blob_key), true)
  } finally {
    resumeDeletion.resolve()
    await drain
    deletion.mockRestore()
    clock?.mockRestore()
  }
})

test("over 30 images, a link to an image not passed, a repeated name, or images without a Markdown doc are refused", async () => {
  const many = Array.from({ length: 31 }, (_, index) => ({ name: `card-${index}.png` }))
  const tooMany = await call({ markdown: "# Cards", images: many, lifetime: "review" })
  assert.equal(tooMany.isError, true)
  assert.match(tooMany.message, /at most 30 images/)
  assert.equal((await call({ markdown: "# Cards", images: many.slice(0, 30), lifetime: "review" })).isError, undefined)

  const missing = await call({
    markdown: "![](./A.png)\n![](./B.png)",
    images: [{ name: "A.png" }],
    lifetime: "review",
  })
  assert.equal(missing.isError, true)
  assert.match(missing.message, /\.\/B\.png, which isn't in images/)

  const twice = await call({
    markdown: "![](./A.png)",
    images: [{ name: "A.png" }, { name: "A.png" }],
    lifetime: "review",
  })
  assert.match(twice.message, /A\.png twice/)

  const html = await call({ html: "<img src=./A.png>", images: [{ name: "A.png" }], lifetime: "review" })
  assert.match(html.message, /images go with a Markdown doc/)

  const folder = await call({ markdown: "![](./a/A.png)", images: [{ name: "a/A.png" }], lifetime: "review" })
  assert.match(folder.message, /no folders or spaces/)
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM drops").get().n, 1, "only the 30-image doc was published")
})
