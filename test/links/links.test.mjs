import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { sql, state, migrate, reset, who, event, insertDrop } from "../cost/harness.mjs"
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: readDrop } = await import("../../server/mcp/tools/read_drop.ts")
const { default: updateDrop } = await import("../../server/mcp/tools/update_drop.ts")
const { default: linkHandler } = await import("../../server/api/links/[id].get.ts")
const { default: detailHandler } = await import("../../server/api/drops/[id].get.ts")
const { dropPath, newLink, slugify } = await import("../../shared/links.ts")
const { reportTarget } = await import("../../shared/trust.ts")

migrate()
beforeEach(() => {
  reset()
  state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
})

const server = createMcpHandler({ name: "drop-test", version: "1", origin: false, tools: [publish, readDrop, updateDrop] })
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
  return body.result.isError ? { isError: true, message: body.result.content.map(block => block.text).join(" ") } : body.result.structuredContent
}

/** GET a route whose `[id]` param is `id`, as the page does. */
async function get(handler, id, query = "") {
  const request = event(`/api/x/${id}${query}`)
  request.context.params = { id }
  try { return await handler(request) }
  catch (error) { return { status: error.status } }
}

test("slugs read well, stay short, and keep only letters and numbers", () => {
  assert.equal(slugify("Hipoteca de 75.000 € a 10 años (octubre 2026)"), "hipoteca-de-75-000-a-10-anos-octubre-2026")
  assert.equal(slugify("  --Ünïcode__Café!! "), "unicode-cafe")
  assert.equal(slugify("日本語"), "")
  const long = slugify("one two three four five six seven eight nine ten eleven twelve thirteen")
  assert.ok(long.length <= 60 && !long.endsWith("-") && long.startsWith("one-two"), long)
  assert.match(newLink(), /^[0-9a-hjkmnp-tv-z]{12}$/)
  assert.notEqual(newLink(), newLink())
  assert.equal(dropPath({ link: "abc", slug: "plan" }), "/d/abc/plan")
  assert.equal(dropPath({ link: "abc", slug: "plan" }, 2), "/d/abc/plan?v=2")
  assert.equal(dropPath({ link: "abc", slug: "" }), "/d/abc")
})

test("a doc keeps one link across versions; it opens the latest, ?v= pins one, and an old version's id moves to the latest", async () => {
  const v1 = await call(publish, { markdown: "# Hipoteca de 75.000 €", note: "First", lifetime: "review", share: "comment", slug: "Hipoteca Madrid" })
  assert.match(v1.url, /^https:\/\/drop\.example\/d\/[0-9a-z]{12}\/hipoteca-madrid$/)
  const v2 = await call(publish, { previous: v1.url, markdown: "# Hipoteca, v2", note: "Second" })
  assert.equal(v2.version, 2)
  assert.equal(v2.url, v1.url, "the link stays the same")
  const link = v1.url.split("/")[4]
  const row = id => sql.prepare("SELECT link, slug, filename FROM drops WHERE id = ?").get(id)
  assert.deepEqual({ ...row(v1.id) }, { link, slug: "hipoteca-madrid", filename: "hipoteca-madrid.md" })
  assert.deepEqual({ ...row(v2.id) }, { link, slug: "hipoteca-madrid", filename: "hipoteca-madrid.md" })

  state.who = null
  assert.deepEqual(await get(linkHandler, link), { id: v2.id, link, slug: "hipoteca-madrid", version: 2, latest: 2 })
  assert.deepEqual(await get(linkHandler, link, "?v=1"), { id: v1.id, link, slug: "hipoteca-madrid", version: 1, latest: 2 })
  assert.deepEqual(await get(linkHandler, v1.id), { id: v2.id, link, slug: "hipoteca-madrid", version: 2, latest: 2, from: 1 })
  assert.deepEqual(await get(linkHandler, v2.id), { id: v2.id, link, slug: "hipoteca-madrid", version: 2, latest: 2 })
  assert.equal((await get(linkHandler, link, "?v=7")).status, 404)
  assert.equal((await get(linkHandler, "nolinklikethis")).status, 404)
  assert.equal((await get(detailHandler, link)).id, v2.id, "the drop API takes the link too")
})

test("a private doc's link answers like a missing one", async () => {
  const doc = await call(publish, { markdown: "# Private", note: "x", lifetime: "review", slug: "secret" })
  const link = doc.url.split("/")[4]
  state.who = null
  assert.equal((await get(linkHandler, link)).status, 404)
  assert.equal((await get(linkHandler, doc.id)).status, 404)
  state.who = { ...who }
  assert.equal((await get(linkHandler, link)).id, doc.id, "its owner opens it")
})

test("an agent names drops by id, link, or URL, and renames the link for every version", async () => {
  const v1 = await call(publish, { markdown: "# Plan", note: "x", lifetime: "review", slug: "plan" })
  const v2 = await call(publish, { previous: v1.id, markdown: "# Plan 2", note: "y" })
  const link = v1.url.split("/")[4]
  assert.equal((await call(readDrop, { id: link })).id, v2.id)
  assert.equal((await call(readDrop, { id: `${v1.url}?v=1` })).id, v1.id)
  assert.match((await call(updateDrop, { id: v2.id, slug: "!!" })).message, /letters or numbers/)
  assert.match((await call(updateDrop, { id: v2.id, slug: "Launch Plan" })).url, /\/launch-plan$/)
  assert.deepEqual(sql.prepare("SELECT DISTINCT slug FROM drops WHERE link = ?").all(link).map(row => row.slug), ["launch-plan"])
  const v3 = await call(publish, { previous: link, markdown: "# Plan 3", note: "z", slug: "final-plan" })
  assert.equal(v3.version, 3)
  assert.deepEqual(sql.prepare("SELECT DISTINCT slug FROM drops WHERE link = ?").all(link).map(row => row.slug), ["final-plan"])
})

test("without a slug the title names the link; drops from before links open under their id", async () => {
  const doc = await call(publish, { markdown: "# Año nuevo", note: "x", lifetime: "review" })
  assert.match(doc.url, /\/ano-nuevo$/)
  insertDrop("old-drop", { title: "Old Plan" })
  state.who = null
  assert.deepEqual(await get(linkHandler, "old-drop"), { id: "old-drop", link: "old-drop", slug: "old-plan", version: 1, latest: 1 })
})

test("every version of an HTML doc runs on the same content origin", async () => {
  state.contentOrigin = "https://*-drop.example.com"
  const v1 = await call(publish, { html: "<title>Page</title><p>1</p>", note: "x", lifetime: "review", share: "view" })
  const v2 = await call(publish, { previous: v1.id, html: "<title>Page</title><p>2</p>", note: "y" })
  state.who = null
  const first = (await get(detailHandler, v1.id)).contentOrigin
  assert.match(first, /^https:\/\/[a-z2-7]{26}-drop\.example\.com$/)
  assert.equal((await get(detailHandler, v2.id)).contentOrigin, first)
})

test("a slugged link can be reported", () => {
  assert.equal(reportTarget("/d/abc123/some-plan"), "/d/abc123")
  assert.equal(reportTarget("/d/abc123"), "/d/abc123")
  assert.equal(reportTarget("/d/abc/x/y"), null)
})
