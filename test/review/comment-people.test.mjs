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
