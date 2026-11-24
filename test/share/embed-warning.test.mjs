import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { sql, state, migrate, reset, who } from "../cost/harness.mjs"
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: updateTool } = await import("../../server/mcp/tools/update_drop.ts")
const { default: createFolderTool } = await import("../../server/mcp/tools/create_folder.ts")
const { default: patchHandler } = await import("../../server/api/drops/[id].patch.ts")

migrate()
const agent = { ...who, actorKind: "agent", actorName: "Claude Code" }
beforeEach(() => {
  reset()
  state.who = agent
})

const server = createMcpHandler({
  name: "drop-test",
  version: "1",
  origin: false,
  tools: [publish, updateTool, createFolderTool],
})
async function call(tool, input = {}) {
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
  assert.ok(!body.error, body.error?.message)
  const result = body.result
  assert.ok(!result.isError, result.content?.map((block) => block.text).join(" "))
  return { ...result.structuredContent, text: result.content[0].text }
}
function patch(id, body) {
  const event = new H3Event(
    new Request(`https://drop.example/api/drops/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
  event.context.log = { set() {}, error() {} }
  event.context.params = { id }
  return patchHandler(event)
}

const target = (title, extra = {}) =>
  call(publish, {
    html: `<p>${title}</p>`,
    title,
    note: "Demo",
    ...(extra.folder ? {} : { lifetime: "review" }),
    ...extra,
  })
const doc = (markdown, extra = {}) =>
  call(publish, { markdown, note: "Plan", ...(extra.folder ? {} : { lifetime: "review" }), ...extra })
const embedding = (id) =>
  `# Plan\n\n::embed{url="https://drop.example/d/${id}" height=420 title="Demo"}\n::\n\n::drop{link=${id}}\n::\n`
const embedWarnings = (result) => (result.warnings ?? []).filter((line) => line.startsWith("drop/embed-private"))
const LEAD = "People with the public link can't open"

test("a public doc that embeds a drop its readers can't open publishes with a warning", async () => {
  const demo = await target("Rebuild demo")
  const plan = await doc(embedding(demo.id), { share: "public" })
  const [warning, ...more] = embedWarnings(plan)
  assert.equal(more.length, 0, "one warning per embedded drop, however many times the doc embeds it")
  assert.match(warning, /"Rebuild demo"/)
  assert.ok(warning.includes(`/d/${demo.id}`))
  assert.ok(plan.text.includes(LEAD), plan.text)
  assert.ok(!plan.text.includes("Comark lint warnings"), "embed warnings have their own lead sentence")
})

test("no warning when the doc's readers can open what it embeds, or the doc isn't public", async () => {
  const hidden = await target("Hidden demo")
  assert.deepEqual(embedWarnings(await doc(embedding(hidden.id))), [], "a private doc reaches nobody new")

  const open = await target("Open demo", { share: "public" })
  assert.deepEqual(embedWarnings(await doc(embedding(open.id), { share: "public" })), [])

  const folder = await call(createFolderTool, { title: "Demos", lifetime: "review" })
  await call(updateTool, { id: folder.id, share: "public" })
  const inside = await target("Folder demo", { folder: folder.id })
  assert.deepEqual(
    embedWarnings(await doc(embedding(inside.id), { share: "public" })),
    [],
    "a drop in a public folder opens for the doc's readers",
  )

  const quoted = `# How to embed\n\n\`\`\`md\n::drop{link=${hidden.id}}\n::\n\`\`\`\n`
  assert.deepEqual(embedWarnings(await doc(quoted, { share: "public" })), [], "an embed shown as code isn't one")
})

test("what readers will see decides: a closed public link warns, a pending share review doesn't", async () => {
  const closed = await target("Closed demo", { share: "public" })
  sql.prepare("UPDATE drops SET public_until = ? WHERE id = ?").run(Date.now() - 1, closed.id)
  assert.equal(embedWarnings(await doc(embedding(closed.id), { share: "public" })).length, 1)

  state.shareApproval = true
  const held = await target("Held demo", { share: "public" })
  assert.deepEqual(
    embedWarnings(await doc(embedding(held.id), { share: "public" })),
    [],
    "both open together once the owner's shares are approved",
  )
  const hidden = await target("Hidden demo")
  assert.equal(embedWarnings(await doc(embedding(hidden.id), { share: "public" })).length, 1)
})

test("making a doc or its folder public warns about embeds its readers can't open", async () => {
  const demo = await target("Rebuild demo")
  const plan = await doc(embedding(demo.id))

  const shared = await call(updateTool, { id: plan.id, share: "public" })
  assert.equal(embedWarnings(shared).length, 1)
  assert.ok(shared.text.includes(LEAD), shared.text)
  assert.equal(shared.share, "public", "the warning never blocks the change")
  assert.deepEqual(embedWarnings(await call(updateTool, { id: plan.id, share: "private" })), [])

  state.who = who
  const browser = await patch(plan.id, { share: "public" })
  assert.deepEqual(
    browser.privateEmbeds.map(({ doc, link, title }) => ({ doc: doc.id, link, title })),
    [{ doc: plan.id, link: demo.id, title: "Rebuild demo" }],
  )
  assert.equal((await patch(plan.id, { title: "Plan, renamed" })).privateEmbeds, undefined)

  state.who = agent
  const folder = await call(createFolderTool, { title: "Plans", lifetime: "review" })
  const inside = await doc(embedding(demo.id), { folder: folder.id })
  const opened = await call(updateTool, { id: folder.id, share: "public" })
  assert.equal(embedWarnings(opened).length, 1)
  assert.match(embedWarnings(opened)[0], /"Plan"/, "a folder's warning names the doc that embeds it")

  const moved = await doc(embedding(demo.id))
  assert.notEqual(moved.id, inside.id)
  assert.equal(embedWarnings(await call(updateTool, { id: moved.id, folder: folder.id })).length, 1)
})

test("a public doc that isn't waiting for review warns about a held drop of the same owner", async () => {
  state.shareApproval = true
  const held = await target("Held demo", { share: "public" })
  const plan = await doc(embedding(held.id), { share: "public" })
  sql.prepare("UPDATE drops SET share_review = NULL WHERE id = ?").run(plan.id)
  const folder = await call(createFolderTool, { title: "Plans", lifetime: "review" })
  const moved = await call(updateTool, { id: plan.id, folder: folder.id })
  assert.equal(embedWarnings(moved).length, 1, "the doc's readers get 403 until the owner's shares are approved")
})

test("an embed of a drop that no longer exists warns", async () => {
  const plan = await doc(embedding("k7f2q9m4x8wd"), { share: "public" })
  const [warning, ...more] = (plan.warnings ?? []).filter((line) => line.startsWith("drop/embed-missing"))
  assert.equal(more.length, 0)
  assert.ok(warning.includes("/d/k7f2q9m4x8wd"), warning)
  assert.match(warning, /no longer exists; readers see a note/)
})

const partial = (result) => (result.warnings ?? []).filter((line) => line.startsWith("drop/embed-partial"))

test("a doc with more embeds than the check reads says how many it skipped", async () => {
  const hidden = []
  for (let index = 0; index < 22; index++) hidden.push(await target(`Hidden ${index}`))
  const markdown = `# Plan\n\n${hidden.map(({ id }) => `::drop{link=${id}}\n::\n`).join("\n")}`
  const plan = await doc(markdown, { share: "public" })
  assert.equal(embedWarnings(plan).length, 20)
  const [line, ...more] = partial(plan)
  assert.equal(more.length, 0)
  assert.match(line, /2 embeds/, line)
  assert.ok(plan.text.includes(line), plan.text)
})

test("a folder with more docs than the check reads checks the newest and says how many it skipped", async () => {
  const folder = await call(createFolderTool, { title: "Plans", lifetime: "review" })
  const oldest = await target("Oldest demo")
  const newest = await target("Newest demo")
  const first = await doc(`# First plan\n\n::drop{link=${oldest.id}}\n::\n`, { folder: folder.id })
  sql.prepare("UPDATE drops SET updated_at = updated_at - 60000 WHERE id = ?").run(first.id)
  for (let index = 0; index < 51; index++) await doc(`# Plan ${index}\n\nNo embeds.\n`, { folder: folder.id })
  const last = await doc(`# Last plan\n\n::drop{link=${newest.id}}\n::\n`, { folder: folder.id })
  sql.prepare("UPDATE drops SET updated_at = updated_at + 60000 WHERE id = ?").run(last.id)
  const opened = await call(updateTool, { id: folder.id, share: "public" })
  const warnings = embedWarnings(opened)
  assert.equal(warnings.length, 1, warnings.join("\n"))
  assert.match(warnings[0], /"Newest demo"/)
  const [line] = partial(opened)
  assert.match(line ?? "", /3 docs/, (opened.warnings ?? []).join("\n"))
})
