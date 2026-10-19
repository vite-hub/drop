import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { sql, state, migrate, reset, who } from "../cost/harness.mjs"
const { findDrop, listDrops, listFolders, listSharedWithMe, permissions, toSummary } = await import("../../server/utils/drops.ts")
const { updateDrop } = await import("../../server/utils/drop-update.ts")
const { createFolder: makeFolder, requireFolder } = await import("../../server/utils/folders.ts")
const { closePublicLinks } = await import("../../server/utils/share.ts")
const { liveShare, sharesFor } = await import("../../shared/share.ts")
const { roleFor } = await import("../../shared/roles.ts")
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: listFoldersTool } = await import("../../server/mcp/tools/list_folders.ts")
const { default: updateTool } = await import("../../server/mcp/tools/update_drop.ts")
const { default: createFolderTool } = await import("../../server/mcp/tools/create_folder.ts")
const { DAY_MS } = await import("../../shared/expiry.ts")

migrate()
const admin = { ...who, userId: "admin", name: "Ada", email: "ada@example.com", role: "admin", actorName: "Ada" }
const mate = { ...who, userId: "mate", name: "Mate", email: "mate@example.com", actorName: "Mate" }
const mateAgent = { ...mate, actorKind: "agent", actorName: "Claude Code" }
beforeEach(() => {
  reset()
  state.mode = "team"
  sql.prepare("INSERT INTO user (id, name, email) VALUES ('admin', 'Ada', 'ada@example.com'), ('mate', 'Mate', 'mate@example.com')").run()
  state.who = mateAgent
})

const server = createMcpHandler({ name: "drop-test", version: "1", origin: false, tools: [publish, listFoldersTool, updateTool, createFolderTool] })
async function call(tool, input = {}) {
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
  return result.isError ? { isError: true, message: result.content.map(block => block.text).join(" ") } : { ...result.structuredContent, text: result.content[0].text }
}
const doc = async (markdown, extra = {}) => {
  const published = await call(publish, { markdown, note: "Draft", ...(extra.folder ? {} : { lifetime: "review" }), ...extra })
  assert.ok(!published.isError, published.message)
  return published
}
const teamFolder = (title, description, parent) => makeFolder(admin, { title, note: description, team: true, folder: parent })

test("one share state resolves what it lets people do, and a closed public link falls back", () => {
  const now = Date.now()
  assert.equal(liveShare("public", now - 1, "team", now), "team", "a closed link is Team again on a team Drop")
  assert.equal(liveShare("public_comment", now - 1, "personal", now), "private", "and Only me on a personal one")
  assert.equal(liveShare("public", now + DAY_MS, "team", now), "public")
  assert.equal(liveShare("public", null, "personal", now), "public", "no date: open until changed")
  assert.equal(liveShare("team_edit", null, "personal", now), "private", "a team share reaches nobody on a personal Drop")

  assert.deepEqual(sharesFor("personal", null, { kind: "markdown" }), ["private", "public", "public_comment"])
  assert.deepEqual(sharesFor("team", 7, { kind: "html" }), ["private", "team", "public", "public_comment"], "editing together is for Markdown")
  assert.deepEqual(sharesFor("team", 0, { kind: "folder", teamFolder: true }), ["team", "team_edit"], "a team folder is never private; 0 days turns public links off")

  const drop = share => ({ ownerId: "owner", share, shareReview: null, quarantinedAt: null })
  assert.deepEqual([permissions(drop("public"), null).view, permissions(drop("public"), null).comment], [true, false])
  assert.equal(permissions(drop("public"), mate).comment, true, "signed in, people comment on a public link")
  assert.equal(permissions(drop("public_comment"), null).comment, true, "guests comment on public_comment")
  assert.equal(permissions(drop("public_comment"), mate).edit, false)
  assert.equal(permissions(drop("team"), null).view, false, "a team share never reaches a guest")
  assert.deepEqual([permissions(drop("team"), mate).comment, permissions(drop("team"), mate).edit], [true, false])
  assert.equal(permissions(drop("team_edit"), mate).edit, true)
  assert.equal(permissions(drop("team_edit"), mateAgent).edit, false, "their agents don't edit")
  assert.equal(permissions({ ...drop("public"), shareReview: "pending" }, mate).view, true, "a public link waiting for review still reaches the team")
  assert.equal(permissions({ ...drop("public"), shareReview: "pending" }, null).view, false)
  state.mode = "personal"
  assert.equal(permissions({ ...drop("public"), shareReview: "pending" }, mate).view, false, "and nobody on a personal Drop")
})

test("new drops start shared with the team on a team Drop, private on a personal one", async () => {
  assert.equal((await doc("# Standup")).share, "team")
  state.mode = "personal"
  assert.equal((await doc("# Diary")).share, "private")
  const refused = await call(publish, { markdown: "# x", note: "x", lifetime: "review", share: "team" })
  assert.match(refused.message, /personal/)
})

test("a public link on a team Drop closes after its days and the drop is Team again", async () => {
  const shared = await doc("# Launch post", { share: "public" })
  const until = Date.parse(shared.publicUntil)
  assert.ok(Math.abs(until - (Date.now() + 7 * DAY_MS)) < 60_000, "7 days by default on a team Drop")
  sql.prepare("UPDATE drops SET public_until = ? WHERE id = ?").run(Date.now() - 1, shared.id)
  const closed = await findDrop(shared.id)
  assert.equal(closed.share, "team")
  assert.equal(permissions(closed, null).view, false)
  assert.equal(toSummary(closed).publicUntil, null)
  await closePublicLinks(new Date())
  assert.deepEqual({ ...sql.prepare("SELECT share, public_until FROM drops WHERE id = ?").get(shared.id) }, { share: "team", public_until: null })

  state.publicLinkDays = "0"
  assert.match((await call(publish, { markdown: "# x", note: "x", lifetime: "review", share: "public" })).message, /Public links are off/)
  state.mode = "personal"
  state.publicLinkDays = ""
  assert.equal((await doc("# Open", { share: "public" })).publicUntil, undefined, "a personal Drop keeps links open until changed")
})

test("admins make team folders in the browser; everyone files drops in them, which stay theirs", async () => {
  await assert.rejects(makeFolder(mate, { title: "Mine", team: true }), error => error.status === 403)
  await assert.rejects(makeFolder({ ...admin, actorKind: "agent" }, { title: "Agent's", team: true }), error => error.status === 403)
  const meetings = await teamFolder("Meetings", "Notes from calls. One doc per meeting, named YYYY-MM-DD-topic.")
  assert.equal(meetings.share, "team")
  assert.equal(meetings.lifetime, "keep", "the team's folders never expire")

  const listed = await call(listFoldersTool)
  assert.match(listed.text, /Meetings \(the team's\) id=.*\n {2}Notes from calls\. One doc per meeting/)
  assert.equal(listed.folders[0].description, "Notes from calls. One doc per meeting, named YYYY-MM-DD-topic.")

  const notes = await doc("# 2026-10-19 planning", { folder: meetings.id })
  const row = sql.prepare("SELECT owner_id, share FROM drops WHERE id = ?").get(notes.id)
  assert.equal(row.owner_id, "mate", "a drop in a team folder is its publisher's")
  assert.equal((await findDrop(notes.id)).lifetime, "keep")
  assert.equal(permissions(await findDrop(notes.id), { ...who, userId: "third", name: "Third" }).view, true)

  // Folders go in a team folder only as team folders an admin makes.
  assert.match((await call(createFolderTool, { title: "Sub", folder: meetings.id })).message, /Only admins add folders/)
  const sub = await teamFolder("Client calls", "Calls with clients.", await findDrop(meetings.id))
  assert.equal(sub.teamFolder, true)
  const personal = await makeFolder(mate, { title: "My notes", lifetime: "review" })
  await assert.rejects(updateDrop(await findDrop(personal.id), mate, { folder: meetings.id }), error => error.status === 403)
  await assert.rejects(requireFolder(sub.id, mateAgent, undefined, await findDrop(meetings.id)), error => error.status === 400 || error.status === 403)

  // The team's folders list for everyone, not as their maker's own.
  assert.deepEqual((await listDrops(admin)).map(drop => drop.title), [])
  assert.deepEqual((await listSharedWithMe(mate)).map(drop => drop.title), ["Meetings"])
  assert.deepEqual((await listFolders(mate)).map(drop => drop.title).sort(), ["Client calls", "Meetings", "My notes"])
  const inside = await (await import("../../server/utils/drops.ts")).listFolder(await findDrop(meetings.id))
  assert.deepEqual(inside.map(drop => drop.title).sort(), ["2026-10-19 planning", "Client calls"])
})

test("anyone on the team trashes what's in a team folder; only admins change the folder, and people describe it", async () => {
  const meetings = await teamFolder("Meetings", "Call notes.")
  const notes = await doc("# Retro", { folder: meetings.id })
  const third = { ...who, userId: "third", name: "Third", email: "third@example.com", actorName: "Third" }
  sql.prepare("INSERT INTO user (id, name, email) VALUES ('third', 'Third', 'third@example.com')").run()

  state.who = { ...third, actorKind: "agent", actorName: "Codex" }
  assert.match((await call(updateTool, { id: notes.id, trash: true })).message, /No drop/, "agents trash only what they may change")
  assert.equal((await findDrop(notes.id)).trashedAt, null)
  await assert.rejects(updateDrop(await findDrop(notes.id), third, { title: "Mine now" }), error => error.status === 404)
  await updateDrop(await findDrop(notes.id), third, { trashed: true })
  assert.ok((await findDrop(notes.id)).trashedAt, "a teammate moves it to its owner's Trash")
  assert.deepEqual((await listDrops(mate, undefined, { trash: true })).map(drop => drop.title), ["Retro"])

  const folder = await findDrop(meetings.id)
  assert.equal(permissions(folder, mate).manage, false)
  assert.equal(permissions(folder, mate).trash, false)
  await assert.rejects(updateDrop(folder, mate, { description: "Mine" }), error => error.status === 404)
  await assert.rejects(updateDrop(folder, { ...admin, actorKind: "agent" }, { description: "Steered" }), error => error.status === 400)
  assert.equal((await updateDrop(folder, admin, { description: "Call notes, one per meeting." })).note, "Call notes, one per meeting.")
  await assert.rejects(updateDrop(folder, admin, { share: "private" }), error => error.status === 400)
  await assert.rejects(updateDrop(folder, admin, { lifetime: "temporary" }), error => error.status === 400)

  // Your own folder's description is yours to write, and your agent's.
  const mine = await call(createFolderTool, { title: "Evidence", lifetime: "keep", keepReason: "PR evidence.", description: "Screenshots for pull requests." })
  assert.equal(mine.description, "Screenshots for pull requests.")
  assert.equal((await call(updateTool, { id: mine.id, description: "Before and after shots." })).description, "Before and after shots.")
})

test("DROP_ADMINS names admins by verified email, whatever they sign in with", () => {
  const admins = "Maxi@Example.com, ops@example.com"
  assert.equal(roleFor({ email: "maxi@example.com", emailVerified: true }, admins), "admin")
  assert.equal(roleFor({ email: "ops@example.com ", emailVerified: true }, admins), "admin")
  assert.equal(roleFor({ email: "maxi@example.com", emailVerified: false }, admins), "member", "an unverified email proves nothing")
  assert.equal(roleFor({ email: "maxi@example.com", emailVerified: false }, admins, true), "admin", "except in nuxt dev and the runtime tests")
  assert.equal(roleFor({ email: "someone@example.com", emailVerified: true }, admins), "member")
  assert.equal(roleFor({ email: "maxi@example.com", emailVerified: true }, ""), "member")
})
