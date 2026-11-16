import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { event, insertDrop, migrate, objects, queries, reset, roundTrips, state, who } from "../cost/harness.mjs"
const { default: detailHandler } = await import("../../server/api/drops/[id].get.ts")
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: createFolder } = await import("../../server/mcp/tools/create_folder.ts")
const { skillsAddCommand } = await import("../../shared/links.ts")

// The Install button on a folder's page (ViewerFolder) reads `install` from the folder's detail: a public skill hub's
// link, or on one of its skills' folders, the hub's link and the skill's name.

migrate()
const agent = { ...who, actorKind: "agent", actorName: "Claude Code" }
beforeEach(() => {
  reset()
  state.who = agent
})

const server = createMcpHandler({ name: "drop-test", version: "1", origin: false, tools: [publish, createFolder] })
async function call(tool, input) {
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
  assert.ok(!body.error && !body.result.isError, body.error?.message ?? body.result.content?.[0]?.text)
  return body.result.structuredContent
}

/** The folder's page payload, for a signed-out visitor unless `as` names someone. */
async function detail(id, as = null) {
  const request = event(`/api/drops/${id}`)
  request.context.params = { id }
  state.who = as
  try {
    return await detailHandler(request)
  } finally {
    state.who = agent
  }
}

const skillMd = (name) => `---\nname: ${name}\ndescription: Use when testing the ${name} hub skill.\n---\n\n# ${name}\n`
const folder = (title, slug, extra = {}) => call(createFolder, { title, slug, ...extra })
const doc = (markdown, slug, folderId) => call(publish, { markdown, slug, folder: folderId, note: "Draft" })

/** A hub with two skills, and a subfolder that isn't one. */
async function hub(share = "public") {
  const root = await folder("Skill hub", "skill-hub", { lifetime: "keep", keepReason: "Shared agent skills.", share })
  const notes = await folder("Release notes", "release-notes", { folder: root.id })
  await doc(skillMd("release-notes"), "skill", notes.id)
  const handoff = await folder("Handoff", "handoff", { folder: root.id })
  await doc(skillMd("handoff"), "skill", handoff.id)
  const drafts = await folder("Drafts", "drafts", { folder: root.id })
  await doc("# Not a skill", "readme", drafts.id)
  return { root, notes, handoff, drafts }
}

test("a public hub's page carries its link and skill count; a skill's folder carries the hub's link and its name", async () => {
  const { root, notes, drafts } = await hub()
  const page = await detail(root.id)
  assert.deepEqual(page.install, { link: root.id, slug: "skill-hub", skills: 2 })
  assert.equal(
    skillsAddCommand("https://drop.example", page.install),
    `npx skills add https://drop.example/d/${root.id}/skill-hub`,
  )

  const skill = await detail(notes.id)
  assert.deepEqual(skill.install, { link: root.id, slug: "skill-hub", skill: "release-notes" })
  assert.equal(
    skillsAddCommand("https://drop.example", skill.install),
    `npx skills add https://drop.example/d/${root.id}/skill-hub --skill release-notes`,
  )
  // The owner, signed in, sees what a stranger installs.
  assert.deepEqual((await detail(root.id, who)).install, page.install)
  // A subfolder that isn't a skill gets no button.
  assert.equal((await detail(drafts.id)).install, undefined)
})

test("private and team folders, public folders with no skills, and other drops carry nothing", async () => {
  const { root: privateHub, notes } = await hub("private")
  assert.equal((await detail(privateHub.id, who)).install, undefined)
  assert.equal((await detail(notes.id, who)).install, undefined)

  const empty = await folder("Notes", "notes", { lifetime: "keep", keepReason: "Notes.", share: "public" })
  await doc("# Hello", "hello", empty.id)
  assert.equal((await detail(empty.id)).install, undefined)
  const loose = await doc(skillMd("loose"), "skill", empty.id)
  assert.equal((await detail(loose.id)).install, undefined)

  state.mode = "team"
  insertDrop("teamhub", {
    kind: "folder",
    title: "Team hub",
    slug: "team-hub",
    visibility: "team",
    team_folder: 1,
    blob_key: null,
  })
  insertDrop("teamskill", {
    kind: "folder",
    title: "Team skill",
    slug: "team-skill",
    parent_id: "teamhub",
    visibility: "team",
    blob_key: null,
  })
  insertDrop("teamdoc", {
    title: "SKILL",
    slug: "skill",
    parent_id: "teamskill",
    visibility: "team",
    blob_key: "teamdoc.md",
  })
  objects.set("teamdoc.md", { body: new Blob([skillMd("team-skill")]), uploadedAt: new Date() })
  assert.equal((await detail("teamhub", who)).install, undefined)
  assert.equal((await detail("teamskill", who)).install, undefined)
})

test("a folder a stranger can't open reads no hub tree, and a public hub's page waits no longer for it", async () => {
  const { root } = await hub("private")
  const tree = () => queries.filter((entry) => entry.query.includes("WITH RECURSIVE down"))
  queries.length = 0
  await detail(root.id, who)
  assert.deepEqual(tree(), [])
  const privateTrips = await roundTrips(() => detail(root.id, who))

  const { root: open } = await hub("public")
  queries.length = 0
  const publicTrips = await roundTrips(() => detail(open.id, who))
  assert.ok(tree().length > 0)
  assert.equal(publicTrips, privateTrips)
})
