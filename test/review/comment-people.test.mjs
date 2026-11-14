import assert from "node:assert/strict"
import { H3Event } from "h3"
import { beforeEach, test } from "vite-plus/test"
import { insertDrop, migrate, reset, sql, state, threads, who } from "../cost/harness.mjs"

const { default: comments } = await import("../../server/comments.ts")
const { default: commentsPost } = await import("../../server/api/drops/[id]/comments.post.ts")
const { default: replyPost } = await import("../../server/api/comments/[id]/replies.post.ts")
const { default: messagePatch } = await import("../../server/api/messages/[id].patch.ts")
const { storeCommentFile } = await import("../../server/utils/comment-images.ts")

migrate()

const bo = { ...who, userId: "bo", name: "Bo Lind", email: "bo@example.com" }
const admin = { ...who, userId: "root", name: "Root", email: "root@example.com", role: "admin" }

beforeEach(() => {
  reset()
  state.who = null
  // reset() keeps the owner's account.
  for (const person of [bo, admin])
    sql
      .prepare("INSERT INTO user (id, name, email, email_verified) VALUES (?, ?, ?, 1)")
      .run(person.userId, person.name, person.email)
  sql.exec("INSERT INTO user (id, name, email, banned) VALUES ('gone', 'Bo Gone', 'gone@example.com', 1)")
  state.identities = { owner: who, bo, root: admin }
})

function request(path, { method = "GET", body, params = {} } = {}) {
  const event = new H3Event(
    new Request(`https://drop.example${path}`, {
      method,
      headers: body ? { "content-type": "application/json", origin: "https://drop.example" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }),
  )
  event.context.log = { set() {}, error() {} }
  event.context.params = params
  return event
}
// What ViteHub's Comments API answers GET /people?subjectKind=drop&subjectId=<id> with, for the one signed in.
async function listPeople(id, q = "") {
  const user = state.who ? { id: state.who.userId, name: state.who.name, identity: state.who } : null
  const [error, people] = await comments.people({ query: q, user, subject: { kind: "drop", id } })
  if (error) throw error
  return people
}
const comment = (id, body) =>
  commentsPost(request(`/api/drops/${id}/comments`, { method: "POST", body, params: { id } }))
const page = { kind: "page", selector: "", ox: 0, oy: 0 }

test("@ suggests people who may read the drop, and only to people signed in", async () => {
  insertDrop("private", { visibility: "private" })
  insertDrop("shared")
  assert.deepEqual(await listPeople("shared"), [], "a signed-out reader lists nobody")

  state.who = who
  // Admins read everything; Bo can't open a private drop, so "@" never offers him there.
  assert.deepEqual(
    (await listPeople("private")).map((person) => person.id),
    ["owner", "root"],
  )
  const shared = await listPeople("shared")
  assert.deepEqual(
    shared.map((person) => person.id),
    ["bo", "owner", "root"],
    "a banned account is never offered",
  )
  assert.deepEqual(Object.keys(shared[0]).sort(), ["id", "name"])
  assert.deepEqual(
    (await listPeople("shared", "lind")).map((person) => person.id),
    ["bo"],
  )
})

test("@ finds people by name without accents or case, and a % or _ in the query is just text", async () => {
  for (const [id, name] of [
    ["jose", "José Núñez"],
    ["zoe", "Zoë Ångström"],
    ["mara", "Mara Josephs"],
    ["deco", "Ana Bajose"],
    ["percent", "100% Ops"],
    ["under", "Ops_Bot"],
  ])
    sql.prepare("INSERT INTO user (id, name, email) VALUES (?, ?, ?)").run(id, name, `${id}@example.com`)
  sql.exec("INSERT INTO user (id, name, email, banned) VALUES ('jo', 'Josefina Gone', 'jo@example.com', 1)")
  const search = async (query, limit = 10) =>
    (await comments.options.people.search(query, limit)).map((person) => person.id)

  // A name that starts with it, then one with a word that does, then one that only contains it; never a banned one.
  assert.deepEqual(await search("jose"), ["jose", "mara", "deco"])
  assert.deepEqual(await search("JOSÉ"), ["jose", "mara", "deco"])
  assert.deepEqual(await search("nunez"), ["jose"])
  assert.deepEqual(await search("zoe angs"), ["zoe"])
  assert.deepEqual(await search("jose", 2), ["jose", "mara"])
  assert.deepEqual(await search("%"), ["percent"])
  assert.deepEqual(await search("s_b"), ["under"])
  assert.deepEqual(await search("", 3), ["percent", "deco", "bo"], "no query lists people by name")
})

test("a mention is an id the text names, of someone who may read the drop", async () => {
  insertDrop("private", { visibility: "private" })
  insertDrop("shared")
  state.who = who
  await assert.rejects(comment("private", { ...page, body: "@Bo Lind look", mentions: ["bo"] }), { status: 400 })
  await assert.rejects(comment("shared", { ...page, body: "Look", mentions: ["bo"] }), { status: 400 })
  const posted = await comment("shared", { ...page, body: "@Bo Lind look", mentions: ["bo"] })
  assert.deepEqual(posted.mentions, ["bo"])
  assert.deepEqual(threads()[0].messages[0].mentions, ["bo"])

  state.who = bo
  const reply = await replyPost(
    request(`/api/comments/${posted.id}/replies`, {
      method: "POST",
      body: { body: "On it, @Owner", mentions: ["owner"] },
      params: { id: posted.id },
    }),
  )
  assert.deepEqual(reply.mentions, ["owner"])
})

test("its author edits a comment's words; nobody else does", async () => {
  insertDrop("shared")
  state.who = who
  const posted = await comment("shared", { ...page, body: "Frist" })
  const edit = (body) =>
    messagePatch(
      request(`/api/messages/${posted.messageId}`, { method: "PATCH", body, params: { id: posted.messageId } }),
    )
  state.who = bo
  await assert.rejects(edit({ body: "Mine now" }), { status: 404 })
  state.who = who
  const edited = await edit({ body: "First" })
  assert.equal(edited.body, "First")
  assert.ok(edited.editedAt)
  assert.equal(threads()[0].messages[0].body, "First")
})

test("ViteHub's surfaces follow Drop's sharing: drop threads by the drop, Drop's own pages for admins", async () => {
  insertDrop("private", { visibility: "private" })
  insertDrop("shared", { access: "view" })
  const as = (person) => ({ id: person.userId, name: person.name, identity: person })
  const can = (user, action, subject) => comments.can({ user, action, subject })
  const drop = (id) => ({ kind: "drop", id })
  assert.equal(await can(as(who), "read", drop("private")), true)
  assert.equal(await can(as(bo), "read", drop("private")), false)
  assert.equal(await can(as(bo), "read", drop("shared")), true)
  assert.equal(await can(null, "read", drop("shared")), true, "a public link reads without an account")
  assert.equal(await can(null, "write", drop("shared")), false, "a view link takes no guest comments")
  assert.equal(await can(as(who), "delete", drop("private")), true)
  assert.equal(await can(as(bo), "delete", drop("shared")), false, "only managers delete other people's words")
  assert.equal(await can(as(bo), "read", { kind: "page", id: "/drops" }), false)
  assert.equal(await can(as(admin), "read", { kind: "page", id: "/drops" }), true)
  assert.equal(await can({ id: "guest:1", name: "Guest", guest: true }, "write", drop("shared")), false)
})

test("a file sent through ViteHub's upload becomes an image of the drop, out of its lists, and reads back", async () => {
  insertDrop("shared")
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  )
  const id = await storeCommentFile(
    { name: "shot.png", size: png.byteLength, data: png },
    { kind: "drop", id: "shared" },
    bo,
  )
  const row = sql.prepare("SELECT kind, parent_id, owner_id, content_type FROM drops WHERE id = ?").get(id)
  assert.deepEqual({ ...row }, { kind: "image", parent_id: "shared", owner_id: "owner", content_type: "image/png" })
  assert.equal(sql.prepare("SELECT count(*) AS n FROM comment_attachments WHERE drop_id = ?").get(id).n, 1)
  // ViteHub's GET /attachments/<id> reads it back with its type, once it checked the reader may read a thread with it.
  const file = await comments.options.readAttachment(id, { user: null, thread: {} })
  assert.equal(file.type, "image/png")
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), png)
  assert.equal(await comments.options.readAttachment("missing", { user: null, thread: {} }), null)
  await assert.rejects(
    storeCommentFile({ name: "a.txt", size: 2, data: new Uint8Array([104, 105]) }, { kind: "drop", id: "shared" }, bo),
    { status: 400 },
  )
  insertDrop("private", { visibility: "private" })
  await assert.rejects(
    storeCommentFile({ name: "shot.png", size: png.byteLength, data: png }, { kind: "drop", id: "private" }, bo),
    { status: 404 },
  )
})

test("an image sent from the toolbar on Drop's own pages is a blob of its own, for admins only", async () => {
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  )
  const as = (person) => ({ id: person.userId, name: person.name, identity: person })
  const subject = { kind: "page", id: "/d/gv3sp2a5m1t4/vitehub-console-prototype" }
  const store = (user, file = { name: "shot.png", size: png.byteLength, data: png }) =>
    comments.options.storeAttachment(file, { user, subject })
  const drops = () => sql.prepare("SELECT count(*) AS n FROM drops").get().n
  const before = drops()

  const key = await store(as(admin))
  assert.match(key, /^comments\/page\/[\da-f-]{36}\/shot\.png$/)
  assert.equal(drops(), before, "no image drop: a page has no drop to keep it under")
  const file = await comments.options.readAttachment(key, { user: null, thread: {} })
  assert.equal(file.type, "image/png")
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), png)

  // Its name follows its bytes, not what the browser called it.
  assert.match(await store(as(admin), { name: "photo.gif", size: png.byteLength, data: png }), /\/photo\.png$/)
  await assert.rejects(store(as(admin), { name: "a.txt", size: 2, data: new Uint8Array([104, 105]) }), { status: 400 })
  await assert.rejects(store(as(admin), { name: "big.png", size: 5 * 1024 * 1024, data: png }), { status: 413 })
  for (const user of [as(bo), as(who), null, { id: "guest:1", name: "Guest", guest: true }])
    await assert.rejects(store(user), { status: 404 })

  // Only keys of that exact shape read from the store; anything else is still an image drop's id.
  for (const other of [
    key.replace("comments/page/", "comments/"),
    `${key}/x.png`,
    key.replace(/[\da-f]{8}-/, "../../aa-"),
    key.replace(".png", ".svg"),
  ])
    assert.equal(await comments.options.readAttachment(other, { user: null, thread: {} }), null)
})
