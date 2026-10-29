import assert from "node:assert/strict"
import { beforeEach, test, vi } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { sql, state, migrate, reset, insertDrop, who, objects } from "../cost/harness.mjs"
const { findDrop, listDrops, listSharedWithMe, permissions, toSummary } = await import("../../server/utils/drops.ts")
const { updateDrop } = await import("../../server/utils/drop-update.ts")
const { recordVisit } = await import("../../server/utils/expiry.ts")
const { getUsage } = await import("../../server/utils/quotas.ts")
const { requireBlobAccess } = await import("../../server/utils/content-access.ts")
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: readDrop } = await import("../../server/mcp/tools/read_drop.ts")
const { default: listTool } = await import("../../server/mcp/tools/list_drops.ts")
const { default: updateTool } = await import("../../server/mcp/tools/update_drop.ts")
const { default: createFolder } = await import("../../server/mcp/tools/create_folder.ts")
const { default: listHandler } = await import("../../server/api/drops/index.get.ts")
const { default: detailHandler } = await import("../../server/api/drops/[id].get.ts")
const { default: folderHandler } = await import("../../server/api/folders.post.ts")
const { default: cleanup } = await import("../../server/schedules/cleanup.ts")
const { DAY_MS } = await import("../../shared/expiry.ts")

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
  tools: [publish, readDrop, listTool, updateTool, createFolder],
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
  if (body.error) return { isError: true, message: body.error.message }
  const result = body.result
  return result.isError
    ? { isError: true, message: result.content.map((block) => block.text).join(" ") }
    : { ...result.structuredContent, text: result.content[0].text }
}

function request(path, { method = "GET", body, id, headers = {} } = {}) {
  const event = new H3Event(
    new Request(`https://drop.example${path}`, {
      method,
      headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
  )
  event.context.log = { set() {}, error() {} }
  if (id) event.context.params = { id }
  return event
}

const folder = async (title, extra = {}) => {
  const created = await call(createFolder, { title, ...(extra.folder ? {} : { lifetime: "review" }), ...extra })
  assert.ok(!created.isError, created.message)
  return created
}
const doc = async (markdown, extra = {}) => {
  const published = await call(publish, {
    markdown,
    note: "Draft",
    ...(extra.folder ? {} : { lifetime: "review" }),
    ...extra,
  })
  assert.ok(!published.isError, published.message)
  return published
}
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64")
const exists = (id) => Boolean(sql.prepare("SELECT id FROM drops WHERE id = ?").get(id))

test("a drop in a folder takes the widest share on its path, and can be shared wider on its own", async () => {
  const review = await folder("Review")
  const plan = await doc("# Plan", { folder: review.id })
  assert.equal(plan.share, "private")
  assert.equal(permissions(await findDrop(plan.id), null).view, false)

  await call(updateTool, { id: review.id, share: "public" })
  const viaFolder = await findDrop(plan.id)
  assert.equal(permissions(viaFolder, null).view, true, "sharing the folder shares what's in it")
  assert.equal(permissions(viaFolder, null).comment, false)
  assert.deepEqual(toSummary(viaFolder).sharedFrom, { id: review.id, title: "Review" })
  assert.equal(toSummary(viaFolder).ownShare, "private")
  assert.equal((await call(readDrop, { id: plan.id })).sharedThrough, "Review")

  // Its own share reaches as wide, at a higher level: link visitors may comment on this one doc.
  const own = await call(updateTool, { id: plan.id, share: "public_comment" })
  assert.equal(own.share, "public_comment")
  assert.equal(permissions(await findDrop(plan.id), null).comment, true)
  assert.equal(
    sql.prepare("SELECT share FROM drops WHERE id = ?").get(review.id).share,
    "public",
    "the folder's own share is untouched",
  )

  await call(updateTool, { id: review.id, share: "private" })
  await call(updateTool, { id: plan.id, share: "private" })
  assert.equal(permissions(await findDrop(plan.id), null).view, false)

  // Team shares need a team Drop and a signed-in caller.
  state.mode = "team"
  await call(updateTool, { id: review.id, share: "team" })
  const teammate = { ...who, userId: "mate", name: "Mate", role: "member" }
  assert.equal(permissions(await findDrop(plan.id), teammate).comment, true)
  assert.equal(permissions(await findDrop(plan.id), null).view, false)
})

test("quarantine, a pending share review, and an owner ban above a drop hide it", async () => {
  const review = await folder("Review", { share: "public" })
  const inner = await folder("Inner", { folder: review.id })
  const plan = await doc("# Plan", { folder: inner.id })
  assert.equal(permissions(await findDrop(plan.id), null).view, true)

  sql.prepare("UPDATE drops SET quarantined_at = 1 WHERE id = ?").run(review.id)
  assert.equal(permissions(await findDrop(plan.id), null).view, false, "a quarantined folder hides its subtree")
  assert.equal(permissions(await findDrop(plan.id), who).view, false)

  sql.prepare("UPDATE drops SET quarantined_at = NULL, share_review = 'pending' WHERE id = ?").run(review.id)
  assert.equal(permissions(await findDrop(plan.id), null).view, false, "the strict side wins")

  sql.prepare("UPDATE drops SET share_review = NULL WHERE id = ?").run(review.id)
  sql.prepare("UPDATE user SET banned = 1 WHERE id = 'owner'").run()
  assert.equal(permissions(await findDrop(plan.id), null).view, false)
})

test("a folder's lifetime and Trash apply to everything below it: trash, restore, and purge the subtree", async () => {
  const now = Date.UTC(2026, 9, 17, 12)
  vi.useFakeTimers({ toFake: ["Date"], now })
  const review = await folder("Review", { lifetime: "temporary" })
  const inner = await folder("Inner", { folder: review.id })
  const shot = await call(publish, { file: { name: "before.png", base64: png }, note: "Before", folder: inner.id })
  const plan = await doc(`# Plan\n\n![before](${shot.fileUrl})`, { folder: inner.id })
  const embedded = await call(publish, {
    file: { name: "embedded.png", base64: png },
    note: "Embedded",
    lifetime: "temporary",
  })
  const head = (
    await call(publish, { previous: plan.id, markdown: `# Plan\n\n![a](${embedded.fileUrl})`, note: "With a picture" })
  ).id
  assert.equal(
    sql.prepare("SELECT parent_id FROM drops WHERE id = ?").get(shot.id).parent_id,
    inner.id,
    "a file in a folder stays there when a doc embeds it",
  )
  assert.equal(sql.prepare("SELECT parent_id FROM drops WHERE id = ?").get(embedded.id).parent_id, head)

  assert.equal((await call(readDrop, { id: head })).lifetime, "temporary", "it lives as long as the folder at the top")
  assert.match(
    (await call(updateTool, { id: head, lifetime: "keep", keepReason: "x" })).message,
    /lives as long as its folder/,
  )

  // Visiting anything inside renews the folder at the top.
  sql.prepare("UPDATE drops SET last_accessed_at = ? WHERE id = ?").run(now - 10 * DAY_MS, review.id)
  await recordVisit(request(`/api/drops/${head}`), await findDrop(head), who, "beacon")
  assert.equal(sql.prepare("SELECT last_accessed_at AS at FROM drops WHERE id = ?").get(review.id).at, now)

  // An expired top folder takes the subtree with it.
  sql.prepare("UPDATE drops SET last_accessed_at = ? WHERE id = ?").run(now - 20 * DAY_MS, review.id)
  assert.equal((await findDrop(head)).expired, true)
  sql.prepare("UPDATE drops SET last_accessed_at = ? WHERE id = ?").run(now, review.id)

  state.who = who
  await call(updateTool, { id: review.id, trash: true })
  for (const id of [inner.id, shot.id, head, embedded.id]) assert.equal((await findDrop(id)).expired, true, id)
  assert.deepEqual(
    (await listDrops(who, undefined, { trash: true })).map((drop) => drop.id),
    [review.id],
    "only the top-most node lists in the Trash",
  )
  assert.match((await call(updateTool, { id: head, trash: false })).message, /It's in Review, which is in the Trash/)

  await call(updateTool, { id: review.id, trash: false })
  assert.equal((await findDrop(head)).expired, false)

  // One drop trashed on its own lists in the Trash by itself and comes back alone.
  await call(updateTool, { id: shot.id, trash: true })
  assert.deepEqual(
    (await listDrops(who, undefined, { trash: true })).map((drop) => drop.id),
    [shot.id],
  )
  assert.equal((await findDrop(head)).expired, false)
  await call(updateTool, { id: shot.id, trash: false })

  await call(updateTool, { id: review.id, trash: true })
  vi.advanceTimersByTime(16 * DAY_MS)
  await cleanup.handler({ scheduledAt: new Date(Date.now()) })
  for (const id of [review.id, inner.id, shot.id, plan.id, head, embedded.id]) assert.equal(exists(id), false, id)
  assert.equal(objects.size, 0, "every blob below the folder is gone")
})

test("folders nest eight levels deep and never inside themselves", async () => {
  const path = [await folder("Level 1")]
  for (let level = 2; level <= 8; level++) path.push(await folder(`Level ${level}`, { folder: path.at(-1).id }))
  assert.match((await call(createFolder, { title: "Level 9", folder: path.at(-1).id })).message, /nest 8 levels deep/)
  assert.match(
    (await call(publish, { markdown: "# Deep", note: "x", folder: path.at(-1).id })).message,
    /nest 8 levels deep/,
  )
  assert.ok(
    !(await call(publish, { markdown: "# Deep", note: "x", folder: path[6].id })).isError,
    "a doc fits at depth 8",
  )

  assert.match((await call(updateTool, { id: path[0].id, folder: path[0].id })).message, /can't go inside itself/)
  assert.match((await call(updateTool, { id: path[0].id, folder: path[3].id })).message, /can't go inside itself/)

  // A folder two levels tall with a doc inside takes three levels.
  const tall = await folder("Tall")
  const middle = await folder("Middle", { folder: tall.id })
  await doc("# Leaf", { folder: middle.id })
  assert.match((await call(updateTool, { id: tall.id, folder: path[5].id })).message, /nest 8 levels deep/)
  assert.ok(!(await call(updateTool, { id: tall.id, folder: path[4].id })).isError)
  assert.equal(sql.prepare("SELECT parent_id FROM drops WHERE id = ?").get(tall.id).parent_id, path[4].id)

  // Someone else's folder takes none of your drops.
  insertDrop("theirs", { kind: "folder", owner_id: "someone", blob_key: null, visibility: "private" })
  assert.match((await call(updateTool, { id: tall.id, folder: "theirs" })).message, /No folder you can add to/)
})

test("slugs are unique among a folder's drops, like file names", async () => {
  const review = await folder("Review")
  const first = await doc("# Notes", { folder: review.id, slug: "notes" })
  const second = await doc("# More notes", { folder: review.id, slug: "notes" })
  assert.match(first.url, /\/notes$/)
  assert.match(second.url, /\/notes-2$/)
  const top = await doc("# Notes", { slug: "notes" })
  assert.match(top.url, /\/notes$/, "drops at the top keep their slug: their links differ")
  const moved = await call(updateTool, { id: top.id, folder: review.id })
  assert.match(moved.url, /\/notes-3$/)
  const renamed = await call(updateTool, { id: second.id, slug: "notes" })
  assert.match(renamed.url, /\/notes-2$/, "renaming to a taken slug numbers it")
  const next = await call(publish, { previous: first.id, markdown: "# Notes v2", note: "v2" })
  assert.match(next.url, /\/notes$/, "a next version keeps its own slug")
})

test("folder search finds what's anywhere below the folder and nothing outside it", async () => {
  const review = await folder("Login review", { slug: "login-review" })
  const shots = await folder("Screenshots", { folder: review.id })
  const before = await call(publish, {
    file: { name: "before.png", base64: png },
    title: "Login before",
    note: "x",
    folder: shots.id,
  })
  const after = await call(publish, {
    file: { name: "after.png", base64: png },
    title: "Login after",
    note: "x",
    folder: shots.id,
  })
  await doc("# Login notes", { folder: review.id })
  await call(publish, {
    file: { name: "login-other.png", base64: png },
    title: "Login elsewhere",
    note: "x",
    lifetime: "review",
  })

  state.who = who
  const top = await listHandler(request("/api/drops"))
  assert.deepEqual(
    top.map((drop) => drop.title).sort(),
    ["Login elsewhere", "Login review"],
    "the top lists folders, not what's in them",
  )
  assert.equal(top.find((drop) => drop.kind === "folder").items, 2)

  const children = await listHandler(request(`/api/drops?folder=${review.id}`))
  assert.deepEqual(children.map((drop) => drop.title).sort(), ["Login notes", "Screenshots"])

  const found = await listHandler(request(`/api/drops?folder=${review.url.match(/\/d\/([^/]+)/)[1]}&q=login%20before`))
  assert.deepEqual(
    found.map((drop) => drop.id),
    [before.id],
  )
  assert.deepEqual(
    found[0].path.map((crumb) => crumb.title),
    ["Screenshots"],
    "results say where they sit below the folder",
  )
  assert.match(found[0].thumbnail, /^\/f\/[0-9a-f-]{36}\.png$/)

  const everywhere = await listHandler(request("/api/drops?q=login"))
  assert.deepEqual(
    everywhere.map((drop) => drop.title).sort(),
    ["Login after", "Login before", "Login elsewhere", "Login notes", "Login review"],
    "a search without a folder looks at every depth",
  )

  state.who = agent
  const listed = await call(listTool, { folder: review.url, query: "after" })
  assert.deepEqual(
    listed.drops.map((drop) => drop.id),
    [after.id],
  )
  assert.equal(listed.drops[0].folder, "Screenshots")
  assert.match(listed.drops[0].fileUrl, /^https:\/\/drop\.example\/f\//)
  assert.match((await call(listTool, { folder: "nope" })).message, /No folder with id nope/)
})

test("an agent files its work in a folder, reads it, and moves a drop out", async () => {
  const review = await folder("PR 12 evidence", {
    lifetime: "keep",
    keepReason: "Evidence for vite-hub/drop#12.",
    share: "public",
  })
  assert.equal(review.kind, "folder")
  assert.equal(review.share, "public")
  assert.match(review.text, /folder, 0 items/)
  const shot = await call(publish, { file: { name: "before.png", base64: png }, note: "Before", folder: review.url })
  assert.equal(shot.lifetime, "keep", "it lives as long as the folder")
  assert.equal(shot.sharedThrough, "PR 12 evidence")

  const read = await call(readDrop, { id: review.id })
  assert.deepEqual(
    read.children.map((child) => [child.id, child.kind]),
    [[shot.id, "image"]],
  )
  assert.match(read.text, /## In this folder\n- before/)
  assert.doesNotMatch(read.text, /## Content/)
  assert.equal((await call(readDrop, { id: shot.id })).folder, "PR 12 evidence")

  assert.deepEqual(
    (await call(listTool, {})).drops.map((drop) => drop.id),
    [review.id],
  )
  const out = await call(updateTool, { id: shot.id, folder: "" })
  assert.equal(out.lifetime, "keep", "it keeps the lifetime it lived by")
  assert.equal(out.share, "private", "out of the folder, only its own share is left")
  assert.deepEqual((await call(listTool, {})).drops.map((drop) => drop.id).sort(), [review.id, shot.id].sort())

  // People make folders too, and the drop page answers with its children and the way back up.
  state.who = who
  const inner = await folderHandler(
    request("/api/folders", { method: "POST", body: { title: "Inner", folder: review.id } }),
  )
  await call(updateTool, { id: shot.id, folder: inner.id })
  const detail = await detailHandler(request(`/api/drops/${shot.id}`, { id: shot.id }))
  assert.deepEqual(
    detail.ancestors.map((crumb) => crumb.title),
    ["PR 12 evidence", "Inner"],
  )
  state.who = null
  const visitor = await detailHandler(request(`/api/drops/${inner.id}`, { id: inner.id }))
  assert.deepEqual(
    visitor.children.map((child) => child.id),
    [shot.id],
    "a shared folder opens for visitors, with what's in it",
  )
  await requireBlobAccess(request(shot.fileUrl.replace("https://drop.example", "")), shot.fileUrl.split("/f/")[1])
})

test("folders don't count as drops, drops in them do, and a trashed folder frees its drops' slots", async () => {
  state.quotasEnabled = true
  const review = await folder("Review")
  const shot = await call(publish, { file: { name: "before.png", base64: png }, note: "x", lifetime: "review" })
  await doc(`# Plan\n\n![a](${shot.fileUrl})`, { folder: review.id })
  await doc("# Notes", { folder: review.id })
  assert.equal((await getUsage("owner")).drops.used, 2, "two docs; the folder and the embedded file don't count")
  state.who = who
  await updateDrop(await findDrop(review.id), who, { trashed: true })
  assert.equal((await getUsage("owner")).drops.used, 0)
})

test("Shared with me lists a shared folder once, and a drop shared on its own from a private folder", async () => {
  state.mode = "team"
  sql.prepare("INSERT INTO user (id, name, email) VALUES ('mate', 'Mate', 'mate@example.com')").run()
  const team = await folder("Team folder", { share: "team" })
  await doc("# Inside", { folder: team.id, share: "team" })
  const hidden = await folder("Private folder", { share: "private" })
  const alone = await doc("# Alone", { folder: hidden.id, share: "team" })
  const mate = { ...who, userId: "mate", name: "Mate" }
  const shared = await listSharedWithMe(mate)
  assert.deepEqual(shared.map((drop) => drop.title).sort(), ["Alone", "Team folder"])
  state.who = mate
  const detail = await detailHandler(request(`/api/drops/${alone.id}`, { id: alone.id }))
  assert.deepEqual(detail.ancestors, [], "the private folder's name stays private")
})

test("a site's screenshots hang off it like a doc's embedded files", async () => {
  state.who = who
  insertDrop("site", { kind: "site", blob_key: null, visibility: "private", site_url: "https://example.com" })
  insertDrop("shot", {
    kind: "image",
    blob_key: "shot.png",
    filename: "shot.png",
    visibility: "private",
    parent_id: "site",
  })
  const shot = await findDrop("shot")
  assert.equal(shot.parentId, "site")
  await assert.rejects(updateDrop(shot, who, { title: "x" }), (error) => error.status === 404)
  assert.deepEqual(
    (await listDrops(who)).map((drop) => drop.id),
    ["site"],
  )
  assert.deepEqual(
    (await listDrops(who, undefined, { query: "shot" })).map((drop) => drop.id),
    [],
    "search skips attached files",
  )
  state.quotasEnabled = true
  assert.equal((await getUsage("owner")).drops.used, 1)
})

test("an upload goes into a folder, where it shares and lives with the folder", async () => {
  const { default: filesHandler } = await import("../../server/api/files.post.ts")
  const upload = async (form) => {
    const event = new H3Event(new Request("https://drop.example/api/files", { method: "POST", body: form }))
    event.context.log = { set() {}, error() {}, warn() {} }
    try {
      return await filesHandler(event)
    } catch (error) {
      return { status: error.status, message: error.message }
    }
  }
  const box = await folder("Screenshots", { share: "public_comment" })
  state.who = { ...who }
  const form = new FormData()
  form.append("file", new File(["# Notes"], "notes.md", { type: "text/markdown" }))
  form.append("folder", box.id)
  const uploaded = await upload(form)
  assert.ok(uploaded.id, uploaded.message)
  const row = sql.prepare("SELECT parent_id FROM drops WHERE id = ?").get(uploaded.id)
  assert.equal(row.parent_id, box.id)
  assert.equal((await findDrop(uploaded.id)).share, "public_comment", "it takes the folder's share")

  const elsewhere = new FormData()
  elsewhere.append("file", new File(["# x"], "x.md", { type: "text/markdown" }))
  elsewhere.append("folder", "nope")
  assert.equal((await upload(elsewhere)).status, 404)
})

test("an image in a folder carries the folder's images, in its order, for whoever may open the folder", async () => {
  state.who = null
  const image = (id, updated, extra = {}) =>
    insertDrop(id, { kind: "image", filename: `${id}.png`, blob_key: `${id}.png`, updated_at: updated, ...extra })
  insertDrop("box", { kind: "folder", blob_key: null, share: "public" })
  image("newest", 3, { parent_id: "box" })
  image("middle", 2, { parent_id: "box" })
  image("oldest", 1, { parent_id: "box" })
  image("trashed", 4, { parent_id: "box", trashed_at: 5 })
  insertDrop("notes", { parent_id: "box", updated_at: 6 })
  insertDrop("inner", { kind: "folder", blob_key: null, parent_id: "box" })
  image("deeper", 7, { parent_id: "inner" })
  const gallery = async (id) =>
    (await detailHandler(request(`/api/drops/${id}`, { id }))).gallery?.map((item) => [item.id, item.thumbnail])
  const all = [
    ["newest", "/f/newest.png"],
    ["middle", "/f/middle.png"],
    ["oldest", "/f/oldest.png"],
  ]
  assert.deepEqual(await gallery("middle"), all, "newest first, as the folder lists them; trashed and deeper ones out")
  assert.equal(await gallery("notes"), undefined, "only images get one")
  assert.equal(await gallery("deeper"), undefined, "nothing to move to beside the only image")

  // A visitor reading an image shared on its own from a private folder can't open the folder, so gets no strip.
  sql.prepare("UPDATE drops SET share = 'private' WHERE id = 'box'").run()
  sql.prepare("UPDATE drops SET share = 'public' WHERE id = 'middle'").run()
  assert.equal(await gallery("middle"), undefined)
  state.who = { ...who }
  assert.deepEqual(await gallery("middle"), all, "its owner can")
  sql.prepare("UPDATE drops SET trashed_at = 5 WHERE id = 'newest'").run()
  assert.equal(await gallery("newest"), undefined, "an image in the Trash, which its owner still opens, has none")
  sql.prepare("UPDATE drops SET trashed_at = NULL WHERE id = 'newest'").run()

  // A doc's embedded image belongs to the doc, not a folder.
  insertDrop("doc", { parent_id: "box" })
  image("figure", 1, { parent_id: "doc" })
  image("figure2", 2, { parent_id: "doc" })
  assert.equal(await gallery("figure"), undefined)
})
