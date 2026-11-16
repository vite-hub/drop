import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { parseTarGzip } from "nanotar"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { insertDrop, migrate, objects, reset, roundTrips, sql, state, who } from "../cost/harness.mjs"
const { default: discovery } = await import("../../server/middleware/0.3.well-known.ts")
const { hubSkillNames } = await import("../../server/utils/hub-skills.ts")
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: createFolder } = await import("../../server/mcp/tools/create_folder.ts")
const { default: updateTool } = await import("../../server/mcp/tools/update_drop.ts")

migrate()
const agent = { ...who, actorKind: "agent", actorName: "Claude Code" }
beforeEach(() => {
  reset()
  state.who = agent
})

const sha256 = async (bytes) =>
  `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`

const server = createMcpHandler({
  name: "drop-test",
  version: "1",
  origin: false,
  tools: [publish, createFolder, updateTool],
})
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
  const result = body.result
  assert.ok(!body.error && !result.isError, body.error?.message ?? result.content?.[0]?.text)
  return result.structuredContent
}

/** A request as a signed-out reader sends it. */
async function get(path) {
  const event = new H3Event(new Request(`https://drop.example${path}`))
  event.context.log = { set() {}, error() {} }
  state.who = null
  try {
    return await discovery(event)
  } finally {
    state.who = agent
  }
}

const skillMd = (name, body = "Do the thing.") =>
  `---\nname: ${name}\ndescription: Use when testing the ${name} hub skill.\n---\n\n# ${name}\n\n${body}\n`
const folder = (title, slug, extra = {}) => call(createFolder, { title, slug, ...extra })
const doc = (markdown, slug, folderId) => call(publish, { markdown, slug, folder: folderId, note: "Draft" })
const file = (name, content, folderId) =>
  call(publish, { file: { name, base64: Buffer.from(content).toString("base64") }, folder: folderId, note: "Draft" })

const CHECK = "#!/usr/bin/env node\nconsole.log('ok')\n"
const FORMAT = "# Format\n\nWrite it like this.\n"

/** A hub with two skills: release-notes with a reference and a script, and handoff with its SKILL doc only. */
async function hub({ share = "public" } = {}) {
  const root = await folder("Skill hub", "skill-hub", { lifetime: "keep", keepReason: "Shared agent skills.", share })
  // Their own share is private: they're served through the hub's public link.
  const notes = await folder("Release notes", "release-notes", { folder: root.id })
  const skill = await doc(skillMd("release-notes"), "skill", notes.id)
  const references = await folder("references", "references", { folder: notes.id })
  await doc(FORMAT, "format", references.id)
  const scripts = await folder("scripts", "scripts", { folder: notes.id })
  await file("check.mjs", CHECK, scripts.id)
  // Neither binary files nor drops in the Trash are part of the skill.
  await file("logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0, 0, 0]), scripts.id)
  const gone = await file("old.mjs", "old", scripts.id)
  await call(updateTool, { id: gone.id, trash: true })
  const handoff = await folder("Handoff", "handoff", { folder: root.id })
  await doc(skillMd("handoff"), "skill", handoff.id)
  return { root, notes, skill }
}

test("a public hub serves its skill subfolders under the folder's link, in v0.2.0 and v0.1.0", async () => {
  const { root } = await hub()
  const base = `/d/${root.id}/skill-hub/.well-known`
  const v2 = await get(`${base}/agent-skills/index.json`)
  assert.equal(v2.status, 200)
  assert.equal(v2.headers.get("cache-control"), "public, max-age=60")
  const index = await v2.json()
  assert.deepEqual(
    index.skills.map((skill) => [skill.name, skill.type, skill.url]),
    [
      ["handoff", "skill-md", `${base}/agent-skills/handoff/SKILL.md`],
      ["release-notes", "archive", `${base}/agent-skills/release-notes.tar.gz`],
    ],
  )

  const notes = index.skills[1]
  const archive = new Uint8Array(await (await get(notes.url)).arrayBuffer())
  assert.equal(notes.digest, await sha256(archive))
  const files = await parseTarGzip(archive)
  assert.deepEqual(
    files.map((entry) => entry.name),
    ["SKILL.md", "references/format.md", "scripts/check.mjs"],
  )
  assert.equal(files[0].text, skillMd("release-notes"))
  assert.equal(files[1].text, FORMAT)
  assert.equal(files[2].text, CHECK)

  const handoff = await get(index.skills[0].url)
  assert.equal(handoff.headers.get("content-type"), "text/markdown; charset=utf-8")
  const handoffText = await handoff.text()
  assert.equal(handoffText, skillMd("handoff"))
  assert.equal(index.skills[0].digest, await sha256(new TextEncoder().encode(handoffText)))

  const v1 = await (await get(`${base}/skills/index.json`)).json()
  assert.deepEqual(
    v1.skills.map((skill) => [skill.name, skill.files, skill.version]),
    [
      ["handoff", ["SKILL.md"], index.skills[0].digest.slice(7, 19)],
      ["release-notes", ["SKILL.md", "references/format.md", "scripts/check.mjs"], notes.digest.slice(7, 19)],
    ],
  )
  assert.equal(await (await get(`${base}/skills/release-notes/scripts/check.mjs`)).text(), CHECK)
  assert.equal(await (await get(`${base}/skills/release-notes/references/format.md`)).text(), FORMAT)
  assert.equal((await get(`${base}/skills/release-notes/scripts/logo.png`)).status, 404)

  assert.deepEqual(await hubSkillNames(root.id), ["handoff", "release-notes"])
})

test("the slug segment is optional and can be anything, so a renamed hub keeps working", async () => {
  const { root } = await hub()
  const expected = await (await get(`/d/${root.id}/skill-hub/.well-known/skills/index.json`)).json()
  for (const prefix of [`/d/${root.id}`, `/d/${root.id}/old-name`]) {
    const index = await (await get(`${prefix}/.well-known/agent-skills/index.json`)).json()
    assert.deepEqual(
      index.skills.map((skill) => skill.url),
      [
        `${prefix}/.well-known/agent-skills/handoff/SKILL.md`,
        `${prefix}/.well-known/agent-skills/release-notes.tar.gz`,
      ],
    )
    assert.deepEqual(await (await get(`${prefix}/.well-known/skills/index.json`)).json(), expected)
    assert.equal(await (await get(`${prefix}/.well-known/skills/release-notes/scripts/check.mjs`)).text(), CHECK)
  }
})

test("a subfolder whose SKILL name isn't the subfolder's, without a SKILL doc, or held, is left out", async () => {
  const { root } = await hub()
  // Quarantine holds a subfolder from strangers even though the hub's link is public.
  const held = await folder("Held", "held", { folder: root.id })
  await doc(skillMd("held"), "skill", held.id)
  sql.prepare("UPDATE drops SET quarantined_at = 1 WHERE id = ?").run(held.id)
  const other = await folder("Other", "other", { folder: root.id })
  await doc(skillMd("something-else"), "skill", other.id)
  const empty = await folder("Empty", "empty", { folder: root.id })
  await doc("# Not a skill", "readme", empty.id)
  const broken = await folder("Broken", "broken", { folder: root.id })
  await doc("# No frontmatter", "skill", broken.id)
  const index = await (await get(`/d/${root.id}/skill-hub/.well-known/agent-skills/index.json`)).json()
  assert.deepEqual(
    index.skills.map((skill) => skill.name),
    ["handoff", "release-notes"],
  )
  assert.equal((await get(`/d/${root.id}/x/.well-known/skills/other/SKILL.md`)).status, 404)
  assert.equal((await get(`/d/${root.id}/x/.well-known/skills/held/SKILL.md`)).status, 404)
  assert.deepEqual(await hubSkillNames(root.id), ["handoff", "release-notes"])
})

test("a private folder, a team folder, a doc, or a missing id serves an empty index that names nothing", async () => {
  const { root: privateHub } = await hub({ share: "private" })
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
    title: "Team SKILL",
    slug: "skill",
    parent_id: "teamskill",
    visibility: "team",
    blob_key: "teamdoc.md",
  })
  objects.set("teamdoc.md", { body: new Blob([skillMd("team-skill")]), uploadedAt: new Date() })
  insertDrop("loosedoc", { title: "Loose", visibility: "team", blob_key: "loosedoc.md" })

  for (const id of [privateHub.id, "teamhub", "loosedoc", "nothing-here", "%E0%A4%A"]) {
    for (const path of ["agent-skills/index.json", "skills/index.json"]) {
      const response = await get(`/d/${id}/skill-hub/.well-known/${path}`)
      assert.equal(response.status, 200, `${id} ${path}`)
      const text = await response.text()
      assert.deepEqual(JSON.parse(text).skills, [], `${id} ${path}`)
      for (const name of ["release", "handoff", "team", "Skill hub", "check.mjs", "format", privateHub.id])
        assert.ok(!text.includes(name), `${id} ${path} leaks ${name}`)
    }
    assert.equal((await get(`/d/${id}/.well-known/agent-skills/release-notes.tar.gz`)).status, 404)
    assert.deepEqual(await hubSkillNames(id), [])
  }
  // Signed in as the owner changes nothing: the hub serves what a stranger opens.
  assert.deepEqual(await hubSkillNames(privateHub.id), [])
})

test("publishing a new version of a SKILL doc changes that skill's digest, and only that one", async () => {
  const { root, skill } = await hub()
  const path = `/d/${root.id}/.well-known/agent-skills/index.json`
  const before = (await (await get(path)).json()).skills
  await call(publish, { markdown: skillMd("release-notes", "Do it better."), previous: skill.id, note: "Better" })
  const after = (await (await get(path)).json()).skills
  assert.equal(after[0].digest, before[0].digest)
  assert.notEqual(after[1].digest, before[1].digest)
  const files = await parseTarGzip(new Uint8Array(await (await get(after[1].url)).arrayBuffer()))
  assert.equal(files[0].text, skillMd("release-notes", "Do it better."))
})

test("a hub stops serving once its public link goes: unshared, in the Trash, or the link closes", async () => {
  const { root } = await hub()
  const path = `/d/${root.id}/skill-hub/.well-known/skills/index.json`
  const names = async () => (await (await get(path)).json()).skills.map((skill) => skill.name)
  assert.deepEqual(await names(), ["handoff", "release-notes"])
  await call(updateTool, { id: root.id, share: "private" })
  assert.deepEqual(await names(), [])
  await call(updateTool, { id: root.id, share: "public_comment" })
  assert.deepEqual(await names(), ["handoff", "release-notes"])
  state.publicLinkDays = "7"
  await call(updateTool, { id: root.id, share: "public" })
  // Past the date the link closed on.
  sql.prepare("UPDATE drops SET public_until = ? WHERE id = ?").run(Date.now() - 1, root.id)
  assert.deepEqual(await names(), [])
  sql.prepare("UPDATE drops SET public_until = NULL WHERE id = ?").run(root.id)
  await call(updateTool, { id: root.id, trash: true })
  assert.deepEqual(await names(), [])
})

test("the index reads the hub folder and its tree in one database round trip", async () => {
  const { root } = await hub()
  const count = await roundTrips(() => get(`/d/${root.id}/skill-hub/.well-known/agent-skills/index.json`))
  assert.equal(count, 1)
})
