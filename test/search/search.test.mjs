import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { sql, state, migrate, reset, insertDrop, who, objects } from "../cost/harness.mjs"
const { findDrop, listDrops, recordSharedVisit, searchEverything } = await import("../../server/utils/drops.ts")
const { updateDrop } = await import("../../server/utils/drop-update.ts")
const { indexMissingTexts, MAX_SEARCH_TEXT, searchableText } = await import("../../server/utils/search.ts")
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: createFolder } = await import("../../server/mcp/tools/create_folder.ts")
const { default: listTool } = await import("../../server/mcp/tools/list_drops.ts")
const { default: listHandler } = await import("../../server/api/drops/index.get.ts")
const { default: searchHandler } = await import("../../server/api/search.get.ts")

migrate()
const owner = { ...who, actorKind: "agent", actorName: "Claude Code" }
const mate = { ...who, userId: "mate", name: "Mate", email: "mate@example.com", actorKind: "browser", actorName: "Mate" }
beforeEach(() => {
  reset()
  sql.prepare("INSERT INTO user (id, name, email) VALUES ('mate', 'Mate', 'mate@example.com')").run()
  state.who = owner
})

const server = createMcpHandler({ name: "drop-test", version: "1", origin: false, tools: [publish, createFolder, listTool] })
async function call(tool, input) {
  const request = new H3Event(new Request("https://drop.example/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool.name, arguments: input } }),
  }))
  request.context.log = { set() {}, error() {}, warn() {} }
  const text = await (await toResponse(await server(request), request)).text()
  const body = JSON.parse(text.startsWith("{") ? text : text.match(/^data: (.+)$/m)[1])
  assert.ok(!body.error && !body.result.isError, JSON.stringify(body.error ?? body.result.content))
  return body.result.structuredContent
}
const folder = (title, extra = {}) => call(createFolder, { title, ...(extra.folder ? {} : { lifetime: "review" }), ...extra })
const doc = (markdown, extra = {}) => call(publish, { markdown, note: "Draft", ...(extra.folder ? {} : { lifetime: "review" }), ...extra })
const titles = list => list.map(drop => drop.title).sort()
const textOf = id => sql.prepare("SELECT text FROM drop_texts WHERE drop_id = ?").get(id)?.text

function request(path) {
  const event = new H3Event(new Request(`https://drop.example${path}`))
  event.context.log = { set() {}, error() {} }
  return event
}

test("search reads a doc as text: no front matter, markup, tags, scripts or entities, and at most 64K characters", () => {
  assert.equal(searchableText("markdown", "---\nsupersedes: x\n---\n# Plan\n\n- **Bold** [link text](https://x.dev) and `code`\n> quoted"), "Bold link text and code quoted", "the title's H1 goes")
  assert.equal(searchableText("markdown", "Intro\n\n# Not first"), "Intro Not first")
  assert.equal(searchableText("html", "<html><head><title>T</title><style>p{}</style></head><body><h1>Caf&eacute;</h1><p>Fish &amp; chips&#33;</p><script>alert(1)</script></body></html>"), "Caf&eacute; Fish & chips!")
  assert.equal(searchableText("markdown", "word ".repeat(20_000)).length, MAX_SEARCH_TEXT)
})

test("a doc's text is searchable on its latest version only, with a snippet around the match", async () => {
  const v1 = await doc(`# Mortgage plan\n\n${"Some filler words here. ".repeat(10)}The bank offers a pineapple rate this month.`)
  assert.match(textOf(v1.id), /pineapple rate/)
  const [hit] = await listDrops(owner, undefined, { query: "pineapple" })
  assert.equal(hit.id, v1.id)
  assert.match(hit.snippet, /^….*a pineapple rate this month\.$/)
  assert.equal((await listDrops(owner, undefined, { query: "mortgage" }))[0].snippet, undefined, "a name match needs no snippet")

  const v2 = await doc("# Mortgage plan\n\nThe bank offers a fixed rate now.", { previous: v1.id })
  assert.equal(textOf(v1.id), undefined, "the older version gives its text up")
  assert.deepEqual(await listDrops(owner, undefined, { query: "pineapple" }), [])
  assert.deepEqual((await listDrops(owner, undefined, { query: "fixed rate" })).map(drop => drop.id), [v2.id])
  assert.deepEqual((await listDrops(owner, undefined, { query: "mortgage fixed" })).map(drop => drop.id), [v2.id], "words may match the name or the text")
})

test("another person's private drop never matches, by title or by text; team drops and drops in team folders do", async () => {
  await doc("# Secret roadmap\n\nThe launch codeword is zebra.")
  const team = await doc("# Team notes\n\nWe agreed on zebra stripes.", { share: "comment", audience: "team" })
  const shared = await folder("Shared specs", { share: "view", audience: "team" })
  const sub = await folder("Drafts", { folder: shared.id })
  const inside = await doc("# Inner draft\n\nZebra crossings go here.", { folder: sub.id })
  const hidden = await folder("Private folder")
  await doc("# Hidden draft\n\nMore zebra.", { folder: hidden.id })
  const link = await doc("# Link only\n\nZebra by link.", { share: "view" })

  const found = await searchEverything(mate, "zebra")
  assert.deepEqual(titles(found), ["Inner draft", "Team notes"])
  assert.equal(found.find(drop => drop.id === team.id).owner.name, "Owner")
  assert.deepEqual(found.find(drop => drop.id === inside.id).path.map(crumb => crumb.title), ["Shared specs", "Drafts"])
  assert.deepEqual(await searchEverything(mate, "secret roadmap"), [], "not by title either")
  assert.deepEqual(await searchEverything({ ...mate, role: "admin" }, "secret"), [], "staff don't find private drops here")

  // A link-shared drop joins once you've opened it, like Shared with me.
  await recordSharedVisit(await findDrop(link.id), mate)
  assert.deepEqual(titles(await searchEverything(mate, "zebra")), ["Inner draft", "Link only", "Team notes"])
  // Your own come first, private ones included.
  assert.equal((await searchEverything(owner, "zebra")).length, 5)
})

test("the Trash, review, quarantine and banned owners keep drops out of search", async () => {
  const team = await doc("# Kiwi plan", { share: "comment", audience: "team" })
  const box = await folder("Kiwi folder", { share: "comment", audience: "team" })
  await doc("# Kiwi inside", { folder: box.id })
  assert.equal((await searchEverything(mate, "kiwi")).length, 3)

  state.who = who
  await updateDrop(await findDrop(box.id), who, { trashed: true })
  assert.deepEqual(titles(await searchEverything(mate, "kiwi")), ["Kiwi plan"], "a folder in the Trash takes what it holds along")
  assert.deepEqual(titles(await listDrops(owner, undefined, { query: "kiwi" })), ["Kiwi plan"], "your own search skips the Trash too")

  sql.prepare("UPDATE drops SET share_review = 'pending' WHERE id = ?").run(team.id)
  assert.deepEqual(await searchEverything(mate, "kiwi"), [])
  sql.prepare("UPDATE drops SET share_review = NULL, quarantined_at = 1 WHERE id = ?").run(team.id)
  assert.deepEqual(await searchEverything(mate, "kiwi"), [])
  sql.prepare("UPDATE drops SET quarantined_at = NULL WHERE id = ?").run(team.id)
  sql.prepare("UPDATE user SET banned = 1 WHERE id = 'owner'").run()
  assert.deepEqual(await searchEverything(mate, "kiwi"), [])
})

test("a folder's search finds text below it, and the search API needs a signed-in person", async () => {
  const box = await folder("Research", { share: "view", audience: "team" })
  const sub = await folder("Notes", { folder: box.id })
  await doc("# Interview 3\n\nShe asked about offline mode twice.", { folder: sub.id })
  await doc("# Elsewhere\n\nOffline mode again.")

  state.who = mate
  const below = await listHandler(request(`/api/drops?folder=${box.id}&q=offline`))
  assert.deepEqual(below.map(drop => [drop.title, drop.path.map(crumb => crumb.title)]), [["Interview 3", ["Notes"]]])
  assert.match(below[0].snippet, /offline mode twice/)
  assert.deepEqual(titles(await searchHandler(request("/api/search?q=offline"))), ["Interview 3"])

  state.who = null
  await assert.rejects(searchHandler(request("/api/search?q=offline")), error => error.status === 401)
})

test("agents find docs by their text too", async () => {
  await doc("# Weekly sync\n\nWe postponed the giraffe migration.")
  const listed = await call(listTool, { query: "giraffe" })
  assert.deepEqual(listed.drops.map(drop => drop.title), ["Weekly sync"])
  assert.match(listed.drops[0].match, /giraffe migration/)
})

test("the hourly schedule indexes text docs published before search, once each", async () => {
  insertDrop("old", { visibility: "private", title: "Old plan" })
  objects.set("old.md", { body: new Blob(["# Old plan\n\nA forgotten llama paragraph."]), uploadedAt: new Date() })
  insertDrop("lost", { visibility: "private", title: "Lost plan" })
  objects.delete("lost.md")
  insertDrop("pic", { visibility: "private", kind: "image", blob_key: "pic.png", filename: "pic.png" })
  assert.deepEqual(await listDrops(owner, undefined, { query: "llama" }), [])

  assert.equal(await indexMissingTexts(), 2, "the image has no text to index")
  assert.equal(textOf("lost"), "", "a missing file indexes as empty, so it isn't retried")
  assert.deepEqual((await listDrops(owner, undefined, { query: "llama" })).map(drop => drop.id), ["old"])
  assert.equal(await indexMissingTexts(), 0)
})
