import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { parseTarGzip } from "nanotar"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { calls, event, insertDrop, migrate, objects, reset, roundTrips, sql, state, who } from "../cost/harness.mjs"
const { findDrop, permissions } = await import("../../server/utils/drops.ts")
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

test("one request reads at most 24 MiB: skills past it, in name order, are left out whole", async () => {
  const { root } = await hub()
  // 7 MiB each: a, b and c fit in 24 MiB with the hub's small skills, d doesn't.
  for (const name of ["a-skill", "b-skill", "c-skill", "d-skill"]) await skillWith(root, name, 7, MIB)
  const index = await (await get(`/d/${root.id}/x/.well-known/skills/index.json`)).json()
  assert.deepEqual(
    index.skills.map((skill) => skill.name),
    ["a-skill", "b-skill", "c-skill", "handoff", "release-notes"],
  )
  assert.equal((await get(`/d/${root.id}/x/.well-known/skills/d-skill/f0.txt`)).status, 404)
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
