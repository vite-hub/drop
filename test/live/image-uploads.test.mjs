import assert from "node:assert/strict"
import { H3Event } from "h3"
import { beforeEach, test } from "vite-plus/test"
import { insertDrop, migrate, objects, reset, sql, state, who } from "../cost/harness.mjs"

const { default: uploadFile } = await import("../../server/api/files.post.ts")
const { createDocDrop, dropDetail, findDrop, findDropByBlob, listDrops } = await import("../../server/utils/drops.ts")
const { requireBlobAccess } = await import("../../server/utils/content-access.ts")

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
)
const teammate = { ...who, userId: "teammate", email: "teammate@example.com", actorName: "Teammate" }

migrate()
beforeEach(() => {
  reset()
  state.mode = "team"
  state.who = who
  sql
    .prepare("INSERT INTO user (id, name, email) VALUES (?, ?, ?)")
    .run(teammate.userId, teammate.actorName, teammate.email)
})

function context(request) {
  const event = new H3Event(request)
  event.context.log = { set() {}, error() {}, warn() {} }
  return event
}

function upload(document, file = new File([png], "screenshot.png", { type: "image/png" })) {
  const body = new FormData()
  body.set("document", document)
  body.set("file", file)
  return uploadFile(context(new Request("https://drop.example/api/files", { method: "POST", body })))
}

const readFile = (url) => requireBlobAccess(context(new Request(url)), new URL(url).pathname.slice(3))
const status = (expected) => (error) => error.status === expected

test("an image uploaded into an Only me draft is never a standalone team drop", async () => {
  insertDrop("private-draft", { share: "private" })
  const file = await upload("private-draft")
  await readFile(file.url)
  state.who = teammate
  await assert.rejects(readFile(file.url), status(404))
  await assert.rejects(upload("private-draft"), status(404))
  assert.deepEqual(await listDrops(teammate), [])
})

test("a teammate's upload follows the document across publishing, sharing changes, and Trash", async () => {
  insertDrop("team-draft", { share: "team_edit", lifetime: "keep" })
  state.who = teammate
  const file = await upload("team-draft")
  await readFile(file.url)
  const key = new URL(file.url).pathname.slice(3)
  sql.exec("UPDATE drops SET share = 'team' WHERE id = 'team-draft'")
  await assert.rejects(readFile(file.url), status(404))
  sql.exec("UPDATE drops SET share = 'team_edit' WHERE id = 'team-draft'")
  await createDocDrop(teammate, {
    filename: "team-draft.md",
    supersedes: "team-draft",
    bytes: new TextEncoder().encode(`![Screenshot](${file.url})`),
  })
  const row = await findDropByBlob(key)
  assert.equal(row.parentId, "team-draft")
  assert.equal(row.ownerId, who.userId)
  assert.equal(row.raw.share, "private")
  assert.equal(row.lifetime, "keep")
  await readFile(file.url)
  sql.exec("UPDATE drops SET share = 'private' WHERE id = 'team-draft'")
  await assert.rejects(readFile(file.url), status(404))
  state.who = who
  await readFile(file.url)
  sql.exec("UPDATE drops SET trashed_at = 10 WHERE id = 'team-draft'")
  state.who = teammate
  await assert.rejects(readFile(file.url), status(404))
})

test("only referenced draft images become public when a new version is published", async () => {
  insertDrop("public-draft", { share: "public" })
  const published = await upload("public-draft")
  const unused = await upload("public-draft")
  const origin = "https://drop.example"
  const attachments = async () => (await dropDetail(await findDrop("public-draft"), null, origin)).attachments
  await readFile(published.url)
  state.who = null
  await assert.rejects(readFile(published.url), status(404))
  assert.deepEqual(await attachments(), [])
  const publish = (source) =>
    createDocDrop(who, {
      filename: "public-draft.md",
      supersedes: "public-draft",
      bytes: new TextEncoder().encode(source),
    })
  await publish(`An edit with a URL in code: \`${published.url}\`.`)
  await assert.rejects(readFile(published.url), status(404))
  assert.deepEqual(await attachments(), [])
  await publish(`![Screenshot](${published.url})`)
  await readFile(published.url)
  await assert.rejects(readFile(unused.url), status(404))
  assert.deepEqual(
    (await attachments()).map((file) => file.url),
    [published.url],
  )
  await publish("The screenshot is still available in the older version.")
  await readFile(published.url)
})

test("document uploads require a browser editor and validate image bytes rather than MIME or filename", async () => {
  insertDrop("draft", { share: "team" })
  state.who = teammate
  await assert.rejects(upload("draft"), status(404))
  state.who = { ...who, actorKind: "agent" }
  await assert.rejects(upload("draft"), status(404))
  state.who = who
  await assert.rejects(upload(""), status(404))
  await assert.rejects(upload("draft", new File(["<svg />"], "picture.png", { type: "image/png" })), status(415))
  assert.equal(objects.size, 1)
  const file = await upload("draft", new File([png], "picture.html", { type: "image/png" }))
  assert.match(file.url, /\.png$/)
  assert.equal((await findDropByBlob(new URL(file.url).pathname.slice(3))).contentType, "image/png")
})
