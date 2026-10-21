import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { sql, state, migrate, reset, who } from "../cost/harness.mjs"
const { findDrop, listFolders, listSharedWithMe, permissions } = await import("../../server/utils/drops.ts")
const { updateDrop } = await import("../../server/utils/drop-update.ts")
const { createFolder: makeFolder, requireFolder } = await import("../../server/utils/folders.ts")
const { closePublicLinks } = await import("../../server/utils/share.ts")
const { getUsage } = await import("../../server/utils/quotas.ts")
const { memberLimit } = await import("../../server/utils/teams.ts")
const { default: publish } = await import("../../server/mcp/tools/publish.ts")

// Teams on a personal Drop: a team's folders reach its members, and nobody else signed in.
migrate()
const owner = { ...who, teams: { acme: "owner" } }
const mate = {
  ...who,
  userId: "mate",
  name: "Mate",
  email: "mate@example.com",
  actorName: "Mate",
  teams: { acme: "member" },
}
const mateAgent = { ...mate, actorKind: "agent", actorName: "Claude Code" }
const stranger = {
  ...who,
  userId: "stranger",
  name: "Stranger",
  email: "s@example.com",
  actorName: "Stranger",
  teams: {},
}
const rival = { ...stranger, teams: { other: "owner" } }

beforeEach(() => {
  reset()
  state.teams = true
  sql
    .prepare(
      "INSERT INTO user (id, name, email) VALUES ('mate', 'Mate', 'mate@example.com'), ('stranger', 'Stranger', 's@example.com')",
    )
    .run()
  sql
    .prepare("INSERT INTO organization (id, name, slug) VALUES ('acme', 'Acme', 'acme'), ('other', 'Other', 'other')")
    .run()
  sql
    .prepare(
      "INSERT INTO member (id, organization_id, user_id, role) VALUES ('m1', 'acme', 'owner', 'owner'), ('m2', 'acme', 'mate', 'member'), ('m3', 'other', 'stranger', 'owner')",
    )
    .run()
  state.who = mateAgent
})

const server = createMcpHandler({ name: "drop-test", version: "1", origin: false, tools: [publish] })
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
  if (body.error) return { isError: true, message: body.error.message }
  const result = body.result
  return result.isError
    ? { isError: true, message: result.content.map((block) => block.text).join(" ") }
    : { ...result.structuredContent, text: result.content[0].text }
}
const acmeFolder = (title = "Acme") => makeFolder(owner, { title, teamId: "acme" })

test("a team's owner makes its folders in the browser; members and agents don't, and outsiders can't name it", async () => {
  await assert.rejects(makeFolder(mate, { title: "Mine", teamId: "acme" }), (error) => error.status === 403)
  await assert.rejects(
    makeFolder({ ...owner, actorKind: "agent" }, { title: "Agent's", teamId: "acme" }),
    (error) => error.status === 403,
  )
  await assert.rejects(makeFolder(stranger, { title: "Theirs", teamId: "acme" }), (error) => error.status === 403)
  const folder = await acmeFolder()
  assert.equal(folder.teamFolder, true)
  assert.equal(folder.teamId, "acme")
  assert.equal(folder.share, "team")
  assert.equal(folder.lifetime, "keep", "a team's folders never expire")

  state.teams = false
  await assert.rejects(makeFolder(owner, { title: "Off", teamId: "acme" }), (error) => error.status === 403)
})

test("a team's folders and what's in them reach its members, and nobody else signed in", async () => {
  const folder = await acmeFolder()
  const notes = await call(publish, { markdown: "# Plan", note: "First", folder: folder.id })
  assert.ok(!notes.isError, notes.message)
  const row = sql.prepare("SELECT owner_id, share FROM drops WHERE id = ?").get(notes.id)
  assert.equal(row.owner_id, "mate", "a drop in a team folder stays its publisher's")
  assert.equal(row.share, "team", "drops in a team's folders start shared with the team")

  const drop = await findDrop(notes.id)
  assert.equal(permissions(drop, owner).comment, true)
  assert.equal(permissions(drop, mate).view, true)
  assert.equal(permissions(drop, stranger).view, false, "signed in isn't enough: they're not on the team")
  assert.equal(permissions(drop, rival).view, false, "another team's owner isn't on this one")
  assert.equal(permissions(drop, null).view, false)
  assert.equal(permissions(await findDrop(folder.id), owner).manage, true, "the owner keeps the team's folders")
  assert.equal(permissions(await findDrop(folder.id), mate).manage, false)

  assert.deepEqual(
    (await listSharedWithMe(mate)).map((item) => [item.title, item.team]),
    [["Acme", "acme"]],
  )
  assert.deepEqual(await listSharedWithMe(stranger), [])
  assert.ok((await listFolders(mate)).some((item) => item.id === folder.id))
  assert.ok(!(await listFolders(stranger)).some((item) => item.id === folder.id))
  await assert.rejects(requireFolder(folder.id, stranger), (error) => error.status === 404)
})

test("team shares work only inside a team's folders", async () => {
  const outside = await call(publish, { markdown: "# Mine", note: "x", lifetime: "review", share: "team" })
  assert.match(outside.message, /Only drops in a team's folders share with a team/)
  const folder = await acmeFolder()
  const inside = await call(publish, { markdown: "# Ours", note: "x", folder: folder.id, share: "team_edit" })
  assert.ok(!inside.isError, inside.message)
  assert.equal(permissions(await findDrop(inside.id), mate).edit, true, "the team edits it together")

  // Moved out of the team's folders, a team share reaches nobody.
  await updateDrop(await findDrop(inside.id), mate, { folder: null })
  assert.equal((await findDrop(inside.id)).share, "private")
  assert.equal(permissions(await findDrop(inside.id), owner).view, false)
})

test("a team folder stays with its team, and a closed public link goes back to it", async () => {
  const folder = await acmeFolder()
  const theirs = await makeFolder({ ...stranger, teams: { other: "owner" } }, { title: "Other", teamId: "other" })
  await assert.rejects(
    requireFolder(
      folder.id,
      { ...owner, teams: { acme: "owner", other: "owner" } },
      undefined,
      await findDrop(theirs.id),
    ),
    (error) => error.status === 400,
  )
  sql.prepare("UPDATE drops SET share = 'public', public_until = ? WHERE id = ?").run(Date.now() - 1000, folder.id)
  await closePublicLinks(new Date())
  assert.equal(sql.prepare("SELECT share FROM drops WHERE id = ?").get(folder.id).share, "team")
})

test("the Free plan keeps a few drops forever; new versions of a kept one don't count again", async () => {
  state.quotasEnabled = true
  state.freeKept = 2
  state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
  const keep = (title) => call(publish, { markdown: `# ${title}`, note: "x", lifetime: "keep", keepReason: "PR #1" })
  const first = await keep("One")
  assert.ok(!first.isError, first.message)
  assert.ok(!(await keep("Two")).isError)
  assert.match((await keep("Three")).message, /Plan limit for drops kept forever: 2\/2/)
  const next = await call(publish, { markdown: "# One again", note: "v2", previous: first.id })
  assert.ok(!next.isError, next.message)
  assert.equal((await getUsage("owner")).kept.used, 2)
})

test("a team that pays puts its members on Pro and takes boards away; a free team stops at its free members", async () => {
  state.quotasEnabled = true
  state.billing = true
  assert.equal(await memberLimit("acme"), 3)
  assert.equal((await getUsage("mate")).plan, "free")
  assert.ok(!(await call(publish, { board: { items: [] }, note: "x", lifetime: "review" })).isError)

  sql.prepare("INSERT INTO subscription (id, plan, reference_id, status) VALUES ('s1', 'team', 'acme', 'active')").run()
  assert.equal(await memberLimit("acme"), Number.MAX_SAFE_INTEGER)
  const usage = await getUsage("mate")
  assert.deepEqual([usage.plan, usage.paid, usage.kept.limit], ["pro", true, null])
  assert.match(
    (await call(publish, { board: { items: [] }, note: "x", lifetime: "review" })).message,
    /Boards aren't part of the Team plan/,
  )
  assert.equal((await getUsage("stranger")).plan, "free", "only the paying team's members")

  sql.prepare("UPDATE subscription SET status = 'canceled'").run()
  assert.equal((await getUsage("mate")).plan, "free")
})
