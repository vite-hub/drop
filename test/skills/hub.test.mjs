import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { parseTarGzip } from "nanotar"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { skillArchive, skillDigest } from "vite-hub/skills"
import { calls, event, insertDrop, migrate, objects, reset, roundTrips, sql, state, who } from "../cost/harness.mjs"
const { findDrop, permissions } = await import("../../server/utils/drops.ts")
const { default: discovery } = await import("../../server/middleware/0.3.well-known.ts")
const { BUILT_BYTES, buildBudget, builtSkills, hubSkillNames } = await import("../../server/utils/hub-skills.ts")
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

test("discovery applies the review the page applies now, not the one stored when the link was shared", async () => {
  // Shared while approval was required and the owner not approved yet: the hub's row keeps `share_review = pending`.
  state.shareApproval = true
  const { root, skill } = await hub()
  assert.equal(sql.prepare("SELECT share_review FROM drops WHERE id = ?").get(root.id).share_review, "pending")
  // What a signed-out visitor's `/d/` page opens (findDrop), and what discovery and the Install button serve.
  const page = async (id) => {
    const drop = await findDrop(id, event(`/d/${id}`))
    return Boolean(drop && permissions(drop, null).view)
  }
  const served = async () =>
    (await (await get(`/d/${root.id}/skill-hub/.well-known/agent-skills/index.json`)).json()).skills.map(
      (entry) => entry.name,
    )
  const install = () => hubSkillNames(root.id, event(`/api/drops/${root.id}`))
  const expect = async (open, names, message) => {
    assert.equal(await page(root.id), open, `hub page: ${message}`)
    assert.equal(await page(skill.id), open, `SKILL doc page: ${message}`)
    assert.deepEqual(await served(), names, `discovery: ${message}`)
    assert.deepEqual(await install(), names, `Install button: ${message}`)
  }
  const both = ["handoff", "release-notes"]
  await expect(false, [], "waiting for approval")
  state.shareApproval = false
  await expect(true, both, "approval turned off")
  // Shared again while approval is off, the hub stores no review. A skill shared once approval is back on waits for
  // review on its own, under a hub that doesn't.
  await call(updateTool, { id: root.id, share: "private" })
  await call(updateTool, { id: root.id, share: "public" })
  assert.equal(sql.prepare("SELECT share_review FROM drops WHERE id = ?").get(root.id).share_review, null)
  state.shareApproval = true
  const late = await folder("Late", "late", { folder: root.id, share: "public" })
  const lateSkill = await doc(skillMd("late"), "skill", late.id)
  assert.equal(sql.prepare("SELECT share_review FROM drops WHERE id = ?").get(late.id).share_review, "pending")
  assert.equal(await page(lateSkill.id), false, "the late skill's page waits for review")
  await expect(true, both, "approval back on, the hub stored as reviewed")
  // The owner's approval counts the same way as approval turned off.
  sql.prepare("UPDATE user SET share_approved_at = 1").run()
  assert.equal(await page(lateSkill.id), true, "the late skill's page once the owner is approved")
  await expect(true, ["handoff", "late", "release-notes"], "owner approved")
  sql.prepare("UPDATE user SET share_approved_at = NULL").run()
  state.shareApproval = false
  await call(updateTool, { id: root.id, share: "private" })
  state.shareApproval = true
  await call(updateTool, { id: root.id, share: "public" })
  await expect(false, [], "shared again while approval is required")
})

const MIB = 1024 * 1024

/** Blob keys read while `request` runs, and the most reads in flight at once; each read takes a few milliseconds. */
async function reads(request) {
  const { get: original } = state.blob
  const keys = []
  let inFlight = 0
  let most = 0
  state.blob.get = async (key) => {
    keys.push(key)
    most = Math.max(most, ++inFlight)
    await new Promise((resolve) => setTimeout(resolve, 2))
    inFlight--
    return original(key)
  }
  try {
    await request()
  } finally {
    state.blob.get = original
  }
  return { keys, most }
}

/** A skill subfolder of `root` with a valid SKILL doc and `count` text files of `size` bytes each (as their rows say). */
async function skillWith(root, name, count, size = 8) {
  const at = await folder(name, name, { folder: root.id })
  await doc(skillMd(name), "skill", at.id)
  for (let index = 0; index < count; index++)
    insertDrop(`${name}-${index}`, {
      kind: "file",
      parent_id: at.id,
      title: `f${index}.txt`,
      filename: `f${index}.txt`,
      blob_key: `${name}/${index}.txt`,
      size,
    })
  return at
}

test("a skill over 200 files or 8 MiB is left out whole, its files never read; one at the limits is served", async () => {
  const { root } = await hub()
  // SKILL.md and 199 files: 200, the most a skill may have. One more file is over.
  await skillWith(root, "full", 199)
  await skillWith(root, "crowded", 200)
  // Three 3 MiB files are 9 MiB; two are 6 MiB.
  await skillWith(root, "bulky", 3, 3 * MIB)
  await skillWith(root, "hefty", 2, 3 * MIB)
  const base = `/d/${root.id}/x/.well-known`
  const served = ["full", "handoff", "hefty", "release-notes"]
  const { keys } = await reads(async () => {
    const index = await (await get(`${base}/agent-skills/index.json`)).json()
    assert.deepEqual(
      index.skills.map((skill) => skill.name),
      served,
    )
    for (const name of ["crowded", "bulky"]) {
      assert.equal((await get(`${base}/skills/${name}/SKILL.md`)).status, 404, name)
      assert.equal((await get(`${base}/skills/${name}/f0.txt`)).status, 404, name)
      assert.equal((await get(`${base}/agent-skills/${name}.tar.gz`)).status, 404, name)
    }
  })
  assert.ok(!keys.some((key) => /^(crowded|bulky)\//.test(key)), "an over-limit skill's files are never read")
  const files = await parseTarGzip(new Uint8Array(await (await get(`${base}/agent-skills/full.tar.gz`)).arrayBuffer()))
  assert.equal(files.length, 200)
  assert.deepEqual(await hubSkillNames(root.id), served)
})

test("one request reads at most 8 MiB: skills past it, in name order, are left out whole", async () => {
  const { root } = await hub()
  // 3 MiB each: a and b fit in 8 MiB with the hub's small skills, c and d don't.
  for (const name of ["a-skill", "b-skill", "c-skill", "d-skill"]) await skillWith(root, name, 3, MIB)
  const index = await (await get(`/d/${root.id}/x/.well-known/skills/index.json`)).json()
  assert.deepEqual(
    index.skills.map((skill) => skill.name),
    ["a-skill", "b-skill", "handoff", "release-notes"],
  )
  for (const name of ["c-skill", "d-skill"])
    assert.equal((await get(`/d/${root.id}/x/.well-known/skills/${name}/f0.txt`)).status, 404, name)
})

test("a skill's files are read six at a time", async () => {
  const { root } = await hub()
  await skillWith(root, "many", 40)
  const { keys, most } = await reads(() => get(`/d/${root.id}/x/.well-known/agent-skills/many.tar.gz`))
  assert.equal(keys.length, 41)
  assert.equal(most, 6)
})

test("index and file requests after the first read no blob until a file changes", async () => {
  const { root, skill } = await hub()
  const base = `/d/${root.id}/skill-hub/.well-known`
  const first = await (await get(`${base}/agent-skills/index.json`)).json()
  assert.ok(calls.get > 0)
  calls.get = 0
  assert.deepEqual(await (await get(`${base}/agent-skills/index.json`)).json(), first)
  assert.deepEqual(
    (await (await get(`${base}/skills/index.json`)).json()).skills.map((entry) => entry.name),
    ["handoff", "release-notes"],
  )
  assert.equal(await (await get(`${base}/skills/release-notes/scripts/check.mjs`)).text(), CHECK)
  assert.equal((await get(`${base}/agent-skills/release-notes.tar.gz`)).status, 200)
  assert.equal(await (await get(`${base}/agent-skills/handoff/SKILL.md`)).text(), skillMd("handoff"))
  assert.equal(calls.get, 0, "every answer came from the skills already built")
  // A new version is a new file set: that skill is read again, the other isn't.
  await call(publish, { markdown: skillMd("release-notes", "Do it better."), previous: skill.id, note: "Better" })
  const { keys } = await reads(() => get(`${base}/agent-skills/index.json`))
  assert.equal(keys.length, 4, "release-notes' SKILL doc, reference, script, and the image it leaves out")
  // Still served to a stranger only while the link is public: the cache answers what the tree query lets through.
  await call(updateTool, { id: root.id, share: "private" })
  assert.deepEqual((await (await get(`${base}/agent-skills/index.json`)).json()).skills, [])
})

const CSP = "default-src 'none'; sandbox"

test("HTML and SVG files in a skill come back as sandboxed plain text, not as pages on Drop's origin", async () => {
  const { root, notes } = await hub()
  const page = "<!doctype html><script>parent.postMessage(document.cookie, '*')</script>"
  const image = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>'
  await file("page.html", page, notes.id)
  await file("logo.svg", image, notes.id)
  const base = `/d/${root.id}/x/.well-known`
  for (const [path, text] of [
    ["page.html", page],
    ["logo.svg", image],
  ])
    for (const at of [`${base}/skills/release-notes/${path}`, `${base}/agent-skills/release-notes/${path}`]) {
      const response = await get(at)
      assert.equal(response.status, 200, at)
      assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8", at)
      assert.equal(response.headers.get("content-security-policy"), CSP, at)
      assert.equal(response.headers.get("x-content-type-options"), "nosniff", at)
      assert.equal(await response.text(), text, at)
    }
  const skillDoc = await get(`${base}/skills/release-notes/SKILL.md`)
  assert.equal(skillDoc.headers.get("content-type"), "text/markdown; charset=utf-8")
  assert.equal(skillDoc.headers.get("content-security-policy"), CSP)
})

/** A `.tar.gz` as the skills CLI reads it: each ustar entry's `prefix` and `name` joined, and its text. */
async function untar(gzipped) {
  const bytes = new Uint8Array(
    await new Response(new Blob([gzipped]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(),
  )
  const field = (block, start, length) => {
    const raw = block.subarray(start, start + length)
    const end = raw.indexOf(0)
    return new TextDecoder().decode(end === -1 ? raw : raw.subarray(0, end))
  }
  const files = []
  for (let offset = 0; offset + 512 <= bytes.length && bytes[offset] !== 0;) {
    const header = bytes.subarray(offset, offset + 512)
    const prefix = field(header, 345, 155)
    const name = field(header, 0, 100)
    const size = Number.parseInt(field(header, 124, 12), 8)
    const text = new TextDecoder().decode(bytes.subarray(offset + 512, offset + 512 + size))
    files.push({ name: prefix ? `${prefix}/${name}` : name, text })
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

test("two long paths that share their first 100 bytes stay whole and distinct in the v0.2 archive", async () => {
  const { root, notes } = await hub()
  const outer = await folder("Outer", "o".repeat(60), { folder: notes.id })
  const inner = await folder("Inner", "i".repeat(50), { folder: outer.id })
  await doc("# First\n", "notes-first", inner.id)
  await doc("# Second\n", "notes-second", inner.id)
  const dir = `${"o".repeat(60)}/${"i".repeat(50)}`
  const first = `${dir}/notes-first.md`
  const second = `${dir}/notes-second.md`
  assert.ok(first.length > 100 && first.slice(0, 100) === second.slice(0, 100))

  const base = `/d/${root.id}/x/.well-known`
  const index = await (await get(`${base}/agent-skills/index.json`)).json()
  const entry = index.skills.find((skill) => skill.name === "release-notes")
  const archive = new Uint8Array(await (await get(entry.url)).arrayBuffer())
  assert.equal(entry.digest, await sha256(archive))
  const files = await untar(archive)
  assert.deepEqual(
    files.map((item) => item.name),
    ["SKILL.md", "references/format.md", "scripts/check.mjs", first, second].sort(),
  )
  assert.equal(files.find((item) => item.name === first).text, "# First\n")
  assert.equal(files.find((item) => item.name === second).text, "# Second\n")
  assert.equal(await (await get(`${base}/skills/release-notes/${second}`)).text(), "# Second\n")
})

test("a skill with a path no skill archive can hold is left out whole, and the rest of the hub still serves", async () => {
  const { root } = await hub()
  const odd = await skillWith(root, "odd", 1)
  // A file name over 100 bytes: the ustar `name` field can't hold it, and there is no `/` to split it at.
  insertDrop("odd-long", {
    kind: "file",
    parent_id: odd.id,
    title: "long",
    filename: `${"n".repeat(120)}.txt`,
    blob_key: "odd/long.txt",
    size: 8,
  })
  const base = `/d/${root.id}/x/.well-known`
  for (const path of ["agent-skills/index.json", "skills/index.json"]) {
    const response = await get(`${base}/${path}`)
    assert.equal(response.status, 200, path)
    assert.deepEqual(
      (await response.json()).skills.map((skill) => skill.name),
      ["handoff", "release-notes"],
      path,
    )
  }
  assert.equal((await get(`${base}/skills/odd/SKILL.md`)).status, 404)
  assert.equal((await get(`${base}/skills/odd/f0.txt`)).status, 404)
  assert.equal((await get(`${base}/agent-skills/odd.tar.gz`)).status, 404)
  assert.equal(await (await get(`${base}/skills/release-notes/scripts/check.mjs`)).text(), CHECK)
  assert.equal((await get(`${base}/agent-skills/release-notes.tar.gz`)).status, 200)
  assert.deepEqual(await hubSkillNames(root.id), ["handoff", "release-notes"])
})

/** `size` bytes of printable ASCII drawn at random, so gzip shrinks it little and the archive stays near its input. */
function noise(size) {
  const bytes = new Uint8Array(size)
  for (let at = 0; at < size; at += 65536) crypto.getRandomValues(bytes.subarray(at, at + 65536))
  return bytes.map((byte) => 33 + (byte % 94))
}

/** What a cached skill holds, measured on its objects: key, file bytes, text at 2 bytes a character, archive, digest. */
async function held(key, skill) {
  let bytes = key.length * 2
  if (!skill) return bytes
  for (const file of skill.files)
    bytes += file.bytes.buffer.byteLength + (file.text?.length ?? 0) * 2 + file.path.length * 2
  const archive = await skillArchive(skill)
  return (
    bytes + JSON.stringify(skill.frontmatter).length * 2 + archive.byteLength + (await skillDigest(skill)).length * 2
  )
}

test("the skill cache charges at least what each kept skill holds, and never more than its budget", async () => {
  // Two hubs, each with one skill near the limits: 8 MiB in 9 files, then 200 files in just under 8 MiB. Together they
  // are more than the cache keeps, so the second request makes room.
  const hubs = []
  for (const [name, count, size] of [
    ["big", 8, MIB - 512],
    ["wide", 199, 40 * 1024],
  ]) {
    const root = await folder(`${name} hub`, `${name}-hub`, {
      lifetime: "keep",
      keepReason: "Limits.",
      share: "public",
    })
    await skillWith(root, name, count, size)
    for (let index = 0; index < count; index++)
      objects.set(`${name}/${index}.txt`, { body: new Blob([noise(size)]), uploadedAt: new Date() })
    hubs.push([root, name])
  }
  for (const [root, name] of hubs) {
    const index = await (await get(`/d/${root.id}/x/.well-known/agent-skills/index.json`)).json()
    assert.deepEqual(
      index.skills.map((skill) => skill.name),
      [name],
    )
    assert.equal((await get(index.skills[0].url)).status, 200, name)

    const kept = builtSkills()
    assert.ok(
      kept.some(({ skill }) => skill?.name === name),
      `the cache keeps ${name}, built from ${index.skills[0].name}`,
    )
    let total = 0
    for (const { key, bytes, skill } of kept) {
      total += bytes
      const measured = await held(key, skill)
      assert.ok(bytes >= measured, `${skill?.name ?? key}: charged ${bytes}, holds ${measured}`)
    }
    assert.ok(total <= BUILT_BYTES, `charged ${total} in all, budget ${BUILT_BYTES}`)
  }
  const sizes = builtSkills().map(
    ({ skill }) => skill?.files.reduce((sum, file) => sum + file.bytes.byteLength, 0) ?? 0,
  )
  assert.ok(Math.max(...sizes) > 7 * MIB, "a kept skill is near MAX_SKILL_BYTES")
  assert.ok(!builtSkills().some(({ skill }) => skill?.name === "big"), "big made room for wide")
})

test("Install names exactly the skills discovery serves", async () => {
  const { root } = await hub()
  const png = await skillWith(root, "long-png", 1)
  // An image discovery leaves out once read, and a text file it would serve, each with a name over 100 bytes.
  insertDrop("long-png-image", {
    kind: "image",
    parent_id: png.id,
    title: "diagram",
    filename: `${"p".repeat(120)}.png`,
    blob_key: "long-png/diagram.png",
    size: 12,
  })
  objects.set("long-png/diagram.png", {
    body: new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0, 0, 0])]),
    uploadedAt: new Date(),
  })
  const text = await skillWith(root, "long-text", 1)
  insertDrop("long-text-file", {
    kind: "file",
    parent_id: text.id,
    title: "notes",
    filename: `${"t".repeat(120)}.txt`,
    blob_key: "long-text/notes.txt",
    size: 8,
  })
  await skillWith(root, "crowded", 200)

  const base = `/d/${root.id}/x/.well-known`
  const served = async (path) => (await (await get(`${base}/${path}`)).json()).skills.map((skill) => skill.name)
  const install = await hubSkillNames(root.id)
  // A path no archive holds leaves its skill out, binary or not; release-notes' short-named PNG doesn't.
  assert.deepEqual(install, ["handoff", "release-notes"])
  for (const path of ["agent-skills/index.json", "skills/index.json"])
    assert.deepEqual(await served(path), install, path)
  for (const name of ["handoff", "release-notes", "long-png", "long-text", "crowded"])
    assert.deepEqual(
      await hubSkillNames(root.id, undefined, name),
      install.includes(name) ? [name] : [],
      `${name}'s own Install button`,
    )
})

/** What a stranger's index lists, both versions, checked against what the Install button names. */
async function servedAndInstalled(root) {
  const base = `/d/${root.id}/x/.well-known`
  const v2 = (await (await get(`${base}/agent-skills/index.json`)).json()).skills.map((skill) => skill.name)
  const v1 = (await (await get(`${base}/skills/index.json`)).json()).skills.map((skill) => skill.name)
  assert.deepEqual(v1, v2)
  assert.deepEqual(await hubSkillNames(root.id), v2, "the Install button names what discovery serves")
  return v2
}

test("a SKILL doc whose frontmatter is over 4 KiB is left out, in discovery and the Install button", async () => {
  const { root } = await hub()
  // A frontmatter block of exactly `length` characters, padded in a metadata value.
  const skillDoc = (name, length) => {
    const head = `name: ${name}\ndescription: Long metadata.\nmetadata:\n  notes: ""`
    const block = head.replace('""', `"${"n".repeat(length - head.length)}"`)
    assert.equal(block.length, length)
    return `---\n${block}\n---\n\n# ${name}\n`
  }
  for (const [name, length] of [
    ["at-cap", 4096],
    ["over-cap", 4097],
  ]) {
    const at = await folder(name, name, { folder: root.id })
    await doc(skillDoc(name, length), "skill", at.id)
  }
  assert.deepEqual(await servedAndInstalled(root), ["at-cap", "handoff", "release-notes"])
  assert.equal((await get(`/d/${root.id}/x/.well-known/skills/over-cap/SKILL.md`)).status, 404)
})

/** A skill subfolder of `root` written straight to the database: a folder, its SKILL doc, and `count` small files. */
function quickSkill(root, name, count = 0) {
  insertDrop(`${name}-dir`, { kind: "folder", parent_id: root.id, title: name, slug: name, blob_key: null })
  insertDrop(`${name}-doc`, { parent_id: `${name}-dir`, slug: "skill", title: "SKILL", blob_key: `${name}/SKILL.md` })
  objects.set(`${name}/SKILL.md`, { body: new Blob([skillMd(name)]), uploadedAt: new Date() })
  for (let index = 0; index < count; index++)
    insertDrop(`${name}-${index}`, {
      kind: "file",
      parent_id: `${name}-dir`,
      title: `f${index}.txt`,
      filename: `f${index}.txt`,
      blob_key: `${name}/${index}.txt`,
      size: index % 2 ? 0 : 8,
    })
}

test("one request builds at most 100 skills: those past it, in name order, are left out", async () => {
  const { root } = await hub()
  const names = Array.from({ length: 100 }, (_, index) => `a-${String(index).padStart(3, "0")}`)
  for (const name of names) quickSkill(root, name)
  assert.deepEqual(await servedAndInstalled(root), names)
})

test("one request builds at most 2000 files, empty ones included: skills past it, in name order, are left out", async () => {
  const { root } = await hub()
  // Nine skills of 200 files each are 1800; handoff and release-notes (4 with the image) make 1805. wide's 200 don't
  // fit, zz-small's 1 does. Half the files are empty and still count.
  for (let index = 1; index <= 9; index++) quickSkill(root, `files-${index}`, 199)
  quickSkill(root, "wide", 199)
  quickSkill(root, "zz-small")
  assert.deepEqual(await servedAndInstalled(root), [
    ...Array.from({ length: 9 }, (_, index) => `files-${index + 1}`),
    "handoff",
    "release-notes",
    "zz-small",
  ])
})

/** Runs `body` with the isolate's build budget set to `settings`, as a stranger, then puts both back. */
async function withBudget(settings, body) {
  const saved = { ...buildBudget }
  Object.assign(buildBudget ?? {}, settings)
  state.who = null
  try {
    return await body()
  } finally {
    Object.assign(buildBudget ?? {}, saved)
    state.who = agent
  }
}

/** Holds blob reads of keys under `prefix` until `open()`; `started` resolves on the first one. */
function gate(prefix) {
  const { get: original } = state.blob
  let open
  let started
  const opened = new Promise((resolve) => (open = resolve))
  const first = new Promise((resolve) => (started = resolve))
  const log = []
  state.blob.get = async (key) => {
    log.push(key)
    if (key.startsWith(prefix)) {
      started()
      await opened
    }
    return original(key)
  }
  return { open, started: first, log, restore: () => (state.blob.get = original) }
}

/** A public hub of one skill with a few small files, for the build budget tests. */
async function smallHub(name) {
  const root = await folder(`${name} hub`, `${name}-hub`, { lifetime: "keep", keepReason: "Budget.", share: "public" })
  quickSkill(root, name, 3)
  return root
}

const archiveOf = (root, name) => `/d/${root.id}/x/.well-known/agent-skills/${name}.tar.gz`

test("a build waits while other builds hold the isolate's budget, then runs once they finish", async () => {
  const first = await smallHub("first")
  const second = await smallHub("second")
  const reads = gate("first/")
  try {
    await withBudget({ limit: 1, waitMs: 5000, leaseMs: 60_000 }, async () => {
      const one = discovery(event(archiveOf(first, "first")))
      await reads.started
      const two = discovery(event(archiveOf(second, "second")))
      await new Promise((resolve) => setTimeout(resolve, 30))
      assert.ok(!reads.log.some((key) => key.startsWith("second/")), "second read nothing while first held the budget")
      reads.open()
      const [a, b] = await Promise.all([one, two])
      assert.equal(a.status, 200)
      assert.equal(b.status, 200)
      assert.equal((await parseTarGzip(new Uint8Array(await b.arrayBuffer()))).length, 4)
      const last = reads.log.findLastIndex((key) => key.startsWith("first/"))
      assert.ok(reads.log.findIndex((key) => key.startsWith("second/")) > last, "second read after first finished")
    })
  } finally {
    reads.open()
    reads.restore()
  }
})

test("a build that waits too long answers 503 with Retry-After, and the index lists nothing, uncached", async () => {
  const first = await smallHub("holder")
  const second = await smallHub("waiter")
  const reads = gate("holder/")
  try {
    await withBudget({ limit: 1, waitMs: 40, leaseMs: 60_000 }, async () => {
      const one = discovery(event(archiveOf(first, "holder")))
      await reads.started
      const archive = await discovery(event(archiveOf(second, "waiter")))
      assert.equal(archive.status, 503)
      assert.ok(Number(archive.headers.get("retry-after")) > 0)
      assert.equal(archive.headers.get("cache-control"), "no-store")
      for (const path of ["agent-skills/index.json", "skills/index.json"]) {
        const index = await discovery(event(`/d/${second.id}/x/.well-known/${path}`))
        assert.equal(index.status, 200, path)
        assert.equal(index.headers.get("cache-control"), "no-store", path)
        assert.ok(Number(index.headers.get("retry-after")) > 0, path)
        assert.deepEqual((await index.json()).skills, [], path)
      }
      assert.deepEqual(await hubSkillNames(second.id), [], "the Install button hides while discovery lists nothing")
      reads.open()
      assert.equal((await one).status, 200)
      const index = await discovery(event(`/d/${second.id}/x/.well-known/agent-skills/index.json`))
      assert.equal(index.headers.get("cache-control"), "public, max-age=60")
      assert.deepEqual(
        (await index.json()).skills.map((skill) => skill.name),
        ["waiter"],
      )
    })
  } finally {
    reads.open()
    reads.restore()
  }
})

test("a live build stays charged past the former lease deadline", async () => {
  const first = await smallHub("long-live")
  const next = await smallHub("after-live")
  const reads = gate("long-live/")
  try {
    await withBudget({ limit: 1, waitMs: 80, leaseMs: 10 }, async () => {
      const one = discovery(event(archiveOf(first, "long-live")))
      await reads.started
      try {
        const response = await discovery(event(archiveOf(next, "after-live")))
        assert.equal(response.status, 503)
        assert.ok(!reads.log.some((key) => key.startsWith("after-live/")))
      } finally {
        reads.open()
        await one
      }
    })
  } finally {
    reads.open()
    reads.restore()
  }
})

test("cached skills also wait for admission before borrowing their allocations", async () => {
  const cached = await smallHub("cached-live")
  const holder = await smallHub("holder-live")
  assert.equal((await get(archiveOf(cached, "cached-live"))).status, 200)
  const reads = gate("holder-live/")
  try {
    await withBudget({ limit: 1, waitMs: 40 }, async () => {
      const one = discovery(event(archiveOf(holder, "holder-live")))
      await reads.started
      try {
        assert.equal((await discovery(event(archiveOf(cached, "cached-live")))).status, 503)
      } finally {
        reads.open()
        await one
      }
    })
  } finally {
    reads.open()
    reads.restore()
  }
})

test("failed builds drain started reads and skip queued reads before releasing capacity", async () => {
  const first = await folder("Drain hub", "drain-hub", { lifetime: "keep", keepReason: "Budget.", share: "public" })
  quickSkill(first, "drain-live", 12)
  const next = await smallHub("after-drain")
  const reads = gate("drain-live/")
  const original = state.blob.get
  let fail
  const failed = new Promise((resolve) => (fail = resolve))
  state.blob.get = async (key) => {
    if (key.startsWith("drain-live/") && key.endsWith("/SKILL.md")) {
      fail()
      throw new Error("storage unavailable")
    }
    return original(key)
  }
  try {
    await withBudget({ limit: 1, waitMs: 40 }, async () => {
      let settled = false
      const one = discovery(event(archiveOf(first, "drain-live"))).then(
        () => { settled = true; return undefined },
        () => { settled = true; return undefined },
      )
      await failed
      await reads.started
      try {
        assert.equal((await discovery(event(archiveOf(next, "after-drain")))).status, 503)
        assert.equal(settled, false, "failure waits for sibling reads")
        assert.ok(reads.log.filter((key) => key.startsWith("drain-live/")).length <= 5, "queued reads are skipped")
      } finally {
        reads.open()
        await one
      }
      assert.equal((await discovery(event(archiveOf(next, "after-drain")))).status, 200)
    })
  } finally {
    reads.open()
    reads.restore()
  }
})
