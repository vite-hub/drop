import assert from "node:assert/strict"
import { drizzle } from "drizzle-orm/sqlite-proxy"
import { beforeEach, test } from "vite-plus/test"
import { sql, queries, state, migrate, reset, insertDrop, event, who } from "./harness.mjs"

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
  insertDrop("v1", { link: LINK, parent_id: "folder", share: "public" })
  insertDrop("v2", { link: LINK, version: 2, supersedes_id: "v1", parent_id: "folder", share: "public" })
  insertDrop("image", { kind: "image", blob_key: IMAGE, parent_id: "v2", share: "public" })
  sql
    .prepare(
      "INSERT INTO comments (id, drop_id, n, kind, selector, body, author_id, author_name, created_at) VALUES ('c1', 'v2', 1, 'text', 'p', 'Hi', 'owner', 'Owner', 1)",
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
    detail: await roundTrips(() => get(detailHandler, "v2")),
    comments: await roundTrips(() => get(commentsHandler, "v2")),
    image: await roundTrips(() => requireBlobAccess(event(`/f/${IMAGE}`), IMAGE)),
  }
  // The page reads the link, then the doc and its comments side by side (pages/d/[id]/[[slug]].vue).
  const page = counts.link + Math.max(counts.detail, counts.comments)
  assert.deepEqual({ ...counts, page }, { link: 1, detail: 2, comments: 2, image: 1, page: 3 })
})

test("a link's key finds the latest version and the folders above it in one indexed query", async () => {
  publicDoc()
  for (let i = 0; i < 2000; i++) insertDrop(`other${i}`, { link: `other${i}` })
  const { findDrop } = await import("../../server/utils/drops.ts")
  for (const [key, id] of [
    [LINK, "v2"],
    ["v1", "v1"],
  ]) {
    queries.length = 0
    const found = await findDrop(key)
    assert.equal(found.id, id)
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
  }
})

test("the link answers for the doc it found, every version, and old version ids", async () => {
  publicDoc()
  assert.deepEqual(await get(linkHandler, LINK), { id: "v2", link: LINK, slug: "v2", version: 2, latest: 2 })
  assert.deepEqual(await get(linkHandler, "v1"), { id: "v2", link: LINK, slug: "v2", version: 2, latest: 2, from: 1 })
  const pinned = event(`/api/x/${LINK}?v=1`)
  pinned.context.params = { id: LINK }
  assert.deepEqual(await linkHandler(pinned), { id: "v1", link: LINK, slug: "v2", version: 1, latest: 2 })
})

test("a signed-in admin's page bootstrap reads independent sidebar data in one round trip", async () => {
  state.who = { ...who, role: "admin" }
  let viewer
  const count = await roundTrips(async () => {
    viewer = await meHandler(event("/api/me"))
  })
  assert.equal(viewer.id, who.userId)
  assert.equal(viewer.members, 1)
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
