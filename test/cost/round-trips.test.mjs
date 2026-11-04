import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import {
  sql,
  queries,
  migrate,
  reset,
  insertDrop,
  insertVersion,
  event,
  who,
  roundTrips,
  planOf,
  state,
} from "./harness.mjs"

const { default: linkHandler } = await import("../../server/api/links/[id].get.ts")
const { default: detailHandler } = await import("../../server/api/drops/[id].get.ts")
const { default: commentsHandler } = await import("../../server/api/drops/[id]/comments.get.ts")
const { requireBlobAccess } = await import("../../server/utils/content-access.ts")
const { default: meHandler } = await import("../../server/api/me.get.ts")

migrate()
beforeEach(reset)

const LINK = "abcdefghjkmn"
const IMAGE = "00000000-0000-4000-8000-000000000002.png"

/** A public doc in a folder, at its second version, with an image it embeds and a comment thread on it. */
function publicDoc() {
  insertDrop("folder", { kind: "folder", blob_key: null, share: "public" })
  insertDrop(LINK, { title: "Doc", version: 2, parent_id: "folder", share: "public" })
  insertVersion(LINK, 1)
  insertDrop("image", { kind: "image", blob_key: IMAGE, parent_id: LINK, share: "public" })
  // A ViteHub Comments thread on the doc's list (server/utils/comments.ts), with a guest's reply.
  const metadata = { dropId: LINK, kind: "text", selector: "p", ox: 0, oy: 0, ow: 0, oh: 0 }
  sql
    .prepare(
      "INSERT INTO vitehub_comment_threads (id, scope, n, subject_kind, subject_id, anchor, metadata, revision, status, author_id, author_name, created_at, updated_at) VALUES ('c1', ?, 1, 'drop', ?, '{\"kind\":\"page\"}', ?, 2, 'open', 'owner', 'Owner', 1, 2)",
    )
    .run(
      `drop:${LINK}`,
      LINK,
      JSON.stringify({ ...metadata, quote: null, label: null, page: null, elementX: null, elementY: null }),
    )
  sql.exec(
    "INSERT INTO vitehub_comment_messages (id, thread_id, body, author_id, author_name, mentions, attachments, created_at) VALUES ('c1-1', 'c1', 'Hi', 'owner', 'Owner', '[]', '[]', 1), ('r1', 'c1', 'Yes', 'guest:1', 'Guest', '[]', '[]', 2)",
  )
}

const get = (handler, id) => {
  const request = event(`/api/x/${id}`)
  request.context.params = { id }
  return handler(request)
}

test("a shared doc's page and the APIs it calls wait for few round trips, one after another", async () => {
  publicDoc()
  // Comments reads its tables' shape once per process, on its first query, to tell an old schema (COMMENTS_R0019).
  // A Worker pays that once per isolate; this counts what every request after it waits for.
  await get(commentsHandler, LINK)
  const counts = {
    link: await roundTrips(() => get(linkHandler, LINK)),
    detail: await roundTrips(() => get(detailHandler, LINK)),
    comments: await roundTrips(() => get(commentsHandler, LINK)),
    image: await roundTrips(() => requireBlobAccess(event(`/f/${IMAGE}`), IMAGE)),
  }
  // The page reads the link, then the doc and its comments side by side (pages/d/[id]/[[slug]].vue). Comments reads
  // the doc, then its threads with their messages, the images beside them.
  const page = counts.link + Math.max(counts.detail, counts.comments)
  assert.deepEqual({ ...counts, page }, { link: 1, detail: 2, comments: 2, image: 1, page: 3 })
})

test("an image in a folder brings the folder's images without another round trip", async () => {
  insertDrop("folder", { kind: "folder", blob_key: null, share: "public" })
  for (const id of ["shot1", "shot2"])
    insertDrop(id, { kind: "image", filename: `${id}.png`, blob_key: `${id}.png`, parent_id: "folder" })
  insertDrop("alone", { kind: "image", filename: "alone.png", blob_key: "alone.png", share: "public" })
  let detail
  const inFolder = await roundTrips(async () => (detail = await get(detailHandler, "shot1")))
  assert.equal(detail.gallery.length, 2)
  assert.equal(inFolder, await roundTrips(() => get(detailHandler, "alone")))
})

test("a link's key finds the drop and the folders above it in one indexed query", async () => {
  publicDoc()
  for (let i = 0; i < 2000; i++) insertDrop(`other${i}`)
  const { findDrop } = await import("../../server/utils/drops.ts")
  queries.length = 0
  const found = await findDrop(LINK)
  assert.equal(found.id, LINK)
  assert.deepEqual(
    found.ancestors.map((node) => node.id),
    ["folder"],
  )
  assert.equal(queries.length, 1)
  const plan = planOf(queries[0])
  assert.doesNotMatch(plan, /SCAN (drops|"drops")\b(?! USING)/, plan)
})

test("a signed-in admin's page bootstrap reads independent sidebar data in one round trip", async () => {
  state.who = { ...who, role: "admin" }
  let viewer
  const count = await roundTrips(async () => {
    viewer = await meHandler(event("/api/me"))
  })
  assert.equal(viewer.id, who.userId)
  assert.ok(viewer.skills > 0)
  assert.equal(count, 1, `page bootstrap waited for ${count} sequential database round trips`)
  // Every page asks for it, so a query joining that round trip costs every page view too.
  assert.deepEqual(
    queries.map(({ query }) => query.match(/from "?(\w+)/i)?.[1]),
    ["skill_settings"],
    "the only query reads which skills are on",
  )
})

test("team names and billing join the same bootstrap round trip and preserve the viewer's role", async () => {
  state.teams = state.billing = true
  state.who = { ...who, teams: { acme: "owner", other: "member" } }
  sql.exec("INSERT INTO organization (id, name, slug) VALUES ('other', 'Other', 'other'), ('acme', 'Acme', 'acme')")
  sql.exec("INSERT INTO subscription (id, plan, reference_id, status) VALUES ('s1', 'team', 'acme', 'active')")
  let viewer
  const count = await roundTrips(async () => {
    viewer = await meHandler(event("/api/me"))
  })
  assert.deepEqual(viewer.teams, [
    { id: "acme", name: "Acme", slug: "acme", role: "owner", paid: true },
    { id: "other", name: "Other", slug: "other", role: "member", paid: false },
  ])
  assert.equal(viewer.paid, true)
  assert.equal(count, 1, `team bootstrap waited for ${count} sequential database round trips`)
})

test("a signed-out bootstrap does not read sidebar data", async () => {
  assert.equal(await roundTrips(async () => assert.equal(await meHandler(event("/api/me")), null)), 0)
})
