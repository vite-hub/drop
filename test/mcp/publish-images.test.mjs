import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { migrate, objects, reset, sql, state, who } from "../cost/harness.mjs"
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: imagePut } = await import("../../server/api/uploads/images/[ticket].put.ts")
const { default: uploadPut } = await import("../../server/api/uploads/[ticket].put.ts")
const { deleteDrop, deleteExpiredDrops, findDrop } = await import("../../server/utils/drops.ts")
const { requireBlobAccess } = await import("../../server/utils/content-access.ts")

migrate()
beforeEach(() => {
  reset()
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
  for (const image of first.images) await upload(image.uploadUrl)
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
  state.who = who
  const again = (await call({ previous: first.id, markdown: "![](./A.png)", note: "Latest A" })).structuredContent
  assert.equal(await source(again.id), `![](${swapped.images[0].fileUrl})`, "./A.png finds the newest A.png")
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
