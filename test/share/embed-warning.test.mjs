import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { event, insertDrop, objects, queries, sql, state, migrate, reset, who } from "../cost/harness.mjs"
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: updateTool } = await import("../../server/mcp/tools/update_drop.ts")
const { default: createFolderTool } = await import("../../server/mcp/tools/create_folder.ts")
const { default: patchHandler } = await import("../../server/api/drops/[id].patch.ts")
const { openedEmbeds } = await import("../../server/utils/embed-access.ts")

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
const partial = (result) => (result.warnings ?? []).filter((line) => line.startsWith("drop/embed-partial"))

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

test("an embed the author can't open warns the same whether that drop is private or deleted", async () => {
  sql.prepare("INSERT INTO user (id, name, email) VALUES ('other', 'Other', 'other@example.com')").run()
  insertDrop("h3n8q2w6x4zd", { owner_id: "other", visibility: "private", title: "Someone's secret" })
  const unreadable = (id) =>
    doc(embedding(id), { share: "public" }).then((plan) =>
      (plan.warnings ?? []).filter((line) => line.startsWith("drop/embed")).map((line) => line.replace(id, "<id>")),
    )
  const [hidden, deleted] = [await unreadable("h3n8q2w6x4zd"), await unreadable("k7f2q9m4x8wd")]
  assert.equal(hidden.length, 1, hidden.join("\n"))
  assert.deepEqual(deleted, hidden, "the warning says no more than the drop's 404 does")
  assert.ok(!hidden[0].includes("Someone's secret"), hidden[0])

  state.who = who
  const plan = await doc(embedding("k7f2q9m4x8wd"))
  const browser = await patch(plan.id, { share: "public" })
  assert.deepEqual(browser.privateEmbeds, [{ doc: { id: plan.id, title: "Plan" }, link: "k7f2q9m4x8wd", title: null }])
})

test("a check that fails after the change is saved reports the change and says the check didn't complete", async () => {
  state.who = who
  const demo = await target("Rebuild demo")
  const plan = await doc(embedding(demo.id))
  state.entries.clear()
  const get = state.blob.get
  state.blob.get = async () => [Object.assign(new Error("injected blob outage"), { code: "BLOB_R0001" })]
  try {
    const shared = await patch(plan.id, { share: "public" })
    assert.equal(shared.share, "public")
    assert.equal(shared.embedCheckFailed, true)
    state.who = agent
    const folder = await call(createFolderTool, { title: "Plans", lifetime: "review" })
    await call(updateTool, { id: plan.id, folder: folder.id })
    const opened = await call(updateTool, { id: folder.id, share: "public" })
    assert.equal(opened.share, "public")
    assert.ok(
      (opened.warnings ?? []).some((line) => line.startsWith("drop/embed-unchecked")),
      (opened.warnings ?? []).join("\n"),
    )
    assert.ok(!opened.text.includes(LEAD), "an incomplete check doesn't claim the embeds are broken")
    assert.match(opened.text, /couldn't check every embed/)
  } finally {
    state.blob.get = get
  }
})

test("sharing a folder at the scan limits stays within D1's queries for one request", async () => {
  const folder = await call(createFolderTool, { title: "Plans", lifetime: "review" })
  const demos = []
  for (let index = 0; index < 20; index++) demos.push(await target(`Demo ${index}`))
  const markdown = `# Plan\n\n${demos.map(({ id }) => `::drop{link=${id}}\n::\n`).join("\n")}`
  for (let index = 0; index < 50; index++) await doc(markdown, { folder: folder.id })
  queries.length = 0
  const opened = await call(updateTool, { id: folder.id, share: "public" })
  assert.equal(embedWarnings(opened).length, 50 * 20)
  assert.equal(partial(opened).length, 0)
  assert.ok(queries.length <= 15, `${queries.length} queries; D1 allows 50 a request on Free`)
})

const m1 = { ...who, userId: "m1", name: "Member One", email: "m1@example.com", actorName: "Member One" }
const held = { visibility: "public", access: "view", share_review: "pending" }
/** A team Drop with share reviews, and a team folder whose owner's public share waits for an admin. */
function heldTeamFolder() {
  state.mode = "team"
  state.shareApproval = true
  sql
    .prepare(
      "INSERT INTO user (id, name, email) VALUES ('lead', 'Lead', 'lead@example.com'), ('m1', 'Member One', 'm1@example.com'), ('m2', 'Member Two', 'm2@example.com')",
    )
    .run()
  insertDrop("f4k8m2q6w9zd", {
    ...held,
    owner_id: "lead",
    kind: "folder",
    title: "Team plans",
    blob_key: null,
    team_folder: 1,
  })
}
const member = (id, owner_id) => insertDrop(id, { visibility: "team", owner_id, parent_id: "f4k8m2q6w9zd" })
async function warned(docId, targetId) {
  objects.set(`${docId}.md`, { body: new Blob([embedding(targetId)]), uploadedAt: new Date() })
  const { embeds } = await openedEmbeds(docId, m1, event(`/api/drops/${docId}`))
  return embeds.map(({ link }) => link)
}

test("a doc in a held team folder warns about its author's own held drop, which the folder's approval leaves held", async () => {
  heldTeamFolder()
  insertDrop("s2d7k4n8q3wx", { ...held, owner_id: "m1", title: "Own demo" })
  member("d1x5m8q2k7wz", "m1")
  assert.deepEqual(await warned("d1x5m8q2k7wz", "s2d7k4n8q3wx"), ["s2d7k4n8q3wx"])
})

test("a doc in a held team folder doesn't warn about another member's drop that the same approval opens", async () => {
  heldTeamFolder()
  member("t9w3k6m2q8xd", "m2")
  member("d2z4n7q3k8wx", "m1")
  assert.deepEqual(await warned("d2z4n7q3k8wx", "t9w3k6m2q8xd"), [])
})

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

test("a team owner sharing a folder doesn't warn about a member's held drop that the member's approval opens", async () => {
  state.teams = true
  state.shareApproval = true
  sql
    .prepare(
      "INSERT INTO user (id, name, email) VALUES ('lead', 'Lead', 'lead@example.com'), ('m1', 'Member One', 'm1@example.com')",
    )
    .run()
  insertDrop("f4k8m2q6w9zd", {
    ...held,
    owner_id: "lead",
    kind: "folder",
    title: "Team plans",
    blob_key: null,
    team_folder: 1,
  })
  insertDrop("s2d7k4n8q3wx", { ...held, owner_id: "m1", title: "Member demo" })
  insertDrop("d1x5m8q2k7wz", { ...held, owner_id: "m1", parent_id: "f4k8m2q6w9zd" })
  objects.set("d1x5m8q2k7wz.md", { body: new Blob([embedding("s2d7k4n8q3wx")]), uploadedAt: new Date() })
  const lead = { ...who, userId: "lead", name: "Lead", email: "lead@example.com", actorName: "Lead" }
  const { embeds } = await openedEmbeds("f4k8m2q6w9zd", lead, event("/api/drops/f4k8m2q6w9zd"))
  assert.deepEqual(embeds, [])
})
