import assert from "node:assert/strict"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { beforeEach, test } from "vite-plus/test"
import { sql, queries, state, migrate, reset, insertDrop, insertVersion, event, who } from "./harness.mjs"

// Each D1 query is a round trip from the Worker, ~55 ms in production. Queries that start together share one: here
// every query waits for the current wave, which ends once nothing else can join it, so `waves` counts the round trips
// a request waits for one after another.
let waves = 0
let wave
const nextWave = () =>
  (wave ??= new Promise((resolve) =>
    setImmediate(() => {
      waves++
      wave = undefined
      resolve()
    }),
  ))
const execute = async (query, params, method) => {
  await nextWave()
  queries.push({ query, params })
  const statement = sql.prepare(query)
  if (method === "run" || !statement.columns().length) {
    statement.run(...params)
    return { rows: [] }
  }
  statement.setReturnArrays(true)
  const rows = statement.all(...params)
  return { rows: method === "get" ? rows[0] : rows }
}
state.db = drizzle(execute)
state.db.all = async (query) => {
  await nextWave()
  const compiled = state.db.dialect.sqlToQuery(query)
  return sql.prepare(compiled.sql).all(...compiled.params)
}

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
  sql
    .prepare(
      `INSERT INTO comments (id, drop_id, version, n, kind, selector, body, author_id, author_name, created_at) VALUES ('c1', '${LINK}', 2, 1, 'text', 'p', 'Hi', 'owner', 'Owner', 1)`,
    )
    .run()
  sql
    .prepare(
      "INSERT INTO comment_replies (id, comment_id, body, author_id, author_name, created_at) VALUES ('r1', 'c1', 'Yes', NULL, 'Guest', 2)",
    )
    .run()
}

async function roundTrips(run) {
  await nextWave()
  const start = waves
  await run()
  return waves - start
}
const get = (handler, id) => {
  const request = event(`/api/x/${id}`)
  request.context.params = { id }
  return handler(request)
}

test("a shared doc's page and the APIs it calls wait for few round trips, one after another", async () => {
  publicDoc()
  const counts = {
    link: await roundTrips(() => get(linkHandler, LINK)),
    detail: await roundTrips(() => get(detailHandler, LINK)),
    comments: await roundTrips(() => get(commentsHandler, LINK)),
    image: await roundTrips(() => requireBlobAccess(event(`/f/${IMAGE}`), IMAGE)),
  }
  // The page reads the link, then the doc and its comments side by side (pages/d/[id]/[[slug]].vue).
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
  const plan = sql
    .prepare(`EXPLAIN QUERY PLAN ${queries[0].query}`)
    .all(...queries[0].params)
    .map((row) => row.detail)
    .join("\n")
  assert.doesNotMatch(plan, /SCAN (drops|"drops")\b(?! USING)/, plan)
})

test("the link answers for the drop, its latest version, and the version `?v=` pins", async () => {
  publicDoc()
  assert.deepEqual(await get(linkHandler, LINK), { id: LINK, link: LINK, slug: "doc", version: 2, latest: 2 })
  const pinned = (v) => {
    const request = event(`/api/x/${LINK}?v=${v}`)
    request.context.params = { id: LINK }
    return linkHandler(request)
  }
  assert.deepEqual(await pinned(1), { id: LINK, link: LINK, slug: "doc", version: 1, latest: 2 })
  await assert.rejects(pinned(3), (error) => error.status === 404)
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
