import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { readFileSync } from "node:fs"
import { sql, queries, state, calls, migrate, reset, insertDrop, who, event } from "./harness.mjs"
const { createDocDrop, dropDetail, findDrop, listDrops, versionChain, deleteDrop, publishApp } = await import("../../server/utils/drops.ts")
const { requireBlobAccess, LEGACY_UPLOAD_CUTOFF } = await import("../../server/utils/content-access.ts")
const { default: accessMiddleware } = await import("../../server/middleware/0.drop-access.ts")
const { default: markdownMiddleware } = await import("../../server/middleware/1.markdown-documents.ts")
const { default: detailHandler } = await import("../../server/api/drops/[id].get.ts")
const { default: meHandler } = await import("../../server/api/me.get.ts")
const { createCodeImage } = await import("../../server/utils/code-image-store.ts")

migrate()
beforeEach(reset)
const missing = action => assert.rejects(action, error => error.status === 404)

test("a chain uses one indexed query and preserves older/newer bounds", async () => {
  for (let i = 0; i < 150; i++) insertDrop(`v${i}`, { supersedes_id: i ? `v${i - 1}` : null, version: i + 1 })
  for (let i = 0; i < 2000; i++) insertDrop(`unrelated${i}`)
  const row = await findDrop("v74")
  queries.length = 0
  const chain = await versionChain(row)
  assert.equal(queries.length, 1)
  assert.equal(chain.length, 100)
  assert.equal(chain[0].id, "v124")
  assert.equal(chain.at(-1).id, "v25")
  const { query, params } = queries[0]
  const plan = sql.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...params).map(row => row.detail).join("\n")
  assert.match(plan, /SEARCH d USING INDEX drops_supersedes/)
  assert.doesNotMatch(plan, /SCAN d\b/)
  assert.match(query, /WITH RECURSIVE/)
})

test("listing limits latest drops, rather than losing slots to old versions", async () => {
  for (let i = 0; i < 600; i++) insertDrop(`v${i}`, { supersedes_id: i ? `v${i - 1}` : null, updated_at: 2000 - i })
  for (let i = 0; i < 500; i++) insertDrop(`other${i}`)
  const rows = await listDrops(who)
  assert.equal(rows.length, 500)
  assert.equal(rows.filter(row => row.id.startsWith("v")).length, 1)
  assert.ok(rows.some(row => row.id === "v599"))
  const plan = sql.prepare(`EXPLAIN QUERY PLAN ${queries[0].query}`).all(...queries[0].params).map(row => row.detail).join("\n")
  assert.match(plan, /drop_heads_owner_idx/)
  assert.doesNotMatch(plan, /SCAN drops|drops_owner_idx/)
})

test("publishing from an older doc id still extends the latest version in its chain", async () => {
  insertDrop("first")
  insertDrop("second", { supersedes_id: "first", version: 2 })
  insertDrop("third", { supersedes_id: "second", version: 3 })
  insertDrop("unrelated", { version: 99 })
  const next = await createDocDrop(who, { filename: "plan.md", bytes: new TextEncoder().encode("# Fourth"), supersedes: "first" })
  assert.equal(next.supersedesId, "third")
  assert.equal(next.version, 4)
  assert.deepEqual((await versionChain(next)).map(row => row.id), [next.id, "third", "second", "first"])
})

test("a warm markdown file and detail render never fetch R2 source", async () => {
  const key = "00000000-0000-4000-8000-000000000001.md"
  insertDrop("doc", { blob_key: key })
  const row = await findDrop("doc")
  const first = await dropDetail(row, null, "https://drop.example")
  assert.equal(calls.get, 1)
  state.objects.delete(key) // A warm render remains usable through a source-store outage.
  const second = await dropDetail(row, null, "https://drop.example")
  assert.equal(second.content, first.content)
  assert.equal(second.html, first.html)
  const request = event(`/f/${key}`)
  await accessMiddleware(request)
  const document = await markdownMiddleware(request)
  assert.match(document, /Source/)
  assert.equal(calls.get, 1)
  assert.equal(calls.head, 0)
  assert.equal(request.res.headers.get("Cache-Control"), "private, no-store")
})

test("a banned owner's shared doc, downloads, page, app, and code image all return 404", async () => {
  const key = "00000000-0000-4000-8000-000000000001.md"
  insertDrop("doc", { blob_key: key })
  insertDrop("app", { kind: "app", blob_key: null })
  const imageKey = `code-images/${Date.now() + 300000}/image.svg`
  sql.prepare("INSERT INTO code_images VALUES (?, ?, ?)").run(imageKey, "owner", Date.now() + 300000)
  sql.exec("UPDATE user SET banned = 1 WHERE id = 'owner'")
  for (const path of [`/f/${key}`, `/f/${key}?raw`, `/f/${imageKey}`, "/f/apps/app/file.html", "/d/doc", "/d/app"])
    for (const method of ["GET", "HEAD", "POST"])
      await missing(() => accessMiddleware(event(path, method)))
  const request = event(`/f/${key}`)
  await missing(() => markdownMiddleware(request))
  for (const id of ["doc", "app"]) {
    const request = event(`/api/drops/${id}`)
    request.context.params = { id }
    await missing(() => detailHandler(request))
    const row = await findDrop(id)
    await missing(() => dropDetail(row, { ...who, role: "admin" }, "https://drop.example"))
  }
  assert.equal(calls.get, 0)
  assert.equal(calls.head, 0)
})

test("normal shared files and code images use one owner join, and unban restores access", async () => {
  insertDrop("doc")
  const imageKey = `code-images/${Date.now() + 300000}/image.svg`
  sql.prepare("INSERT INTO code_images VALUES (?, ?, ?)").run(imageKey, "owner", Date.now() + 300000)
  for (const key of ["doc.md", imageKey]) {
    queries.length = 0
    await requireBlobAccess(event(`/f/${key}`), key)
    assert.equal(queries.length, 1)
    assert.match(queries[0].query, /join "user"/)
  }
  sql.exec("UPDATE user SET banned = 1")
  await missing(() => requireBlobAccess(event(`/f/${imageKey}`), imageKey))
  sql.exec("UPDATE user SET banned = 0")
  await requireBlobAccess(event(`/f/${imageKey}`), imageKey)
})

test("failed blob deletion never turns a private old file public, and retries remove its cache", async () => {
  insertDrop("doc", { visibility: "private" })
  state.objects.get("doc.md").uploadedAt = new Date(LEGACY_UPLOAD_CUTOFF - 1)
  const row = await findDrop("doc")
  await dropDetail(row, who, "https://drop.example")
  state.entries.set("nitro:functions:markdown:doc.md.json", { value: "old html" })
  state.failDelete = true
  await deleteDrop(row)
  assert.equal(await findDrop("doc"), null)
  assert.ok(state.objects.has("doc.md"))
  assert.equal(state.entries.size, 0)
  await missing(() => accessMiddleware(event("/f/doc.md")))
  assert.equal(calls.head, 0)
  state.failDelete = false
  await publishApp(who, { files: { "index.html": "new app" } })
  assert.ok(!state.objects.has("doc.md"))
  assert.equal(sql.prepare("SELECT count(*) AS n FROM blob_cleanup").get().n, 0)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM blob_tombstones").get().n, 1)
})

test("cache deletion failure leaves content inaccessible and retryable", async () => {
  insertDrop("doc", { visibility: "private" })
  await dropDetail(await findDrop("doc"), who, "https://drop.example")
  state.failCacheDelete = true
  await deleteDrop(await findDrop("doc"))
  await missing(() => accessMiddleware(event("/f/doc.md")))
  assert.ok(state.entries.size > 0)
  state.failCacheDelete = false
  await publishApp(who, { files: { "index.html": "new app" } })
  assert.equal(state.entries.size, 0)
  assert.ok(!state.objects.has("doc.md"))
})

test("only untracked uploads before the rebuild stay public", async () => {
  state.objects.set("legacy.md", { uploadedAt: new Date(LEGACY_UPLOAD_CUTOFF - 1) })
  await requireBlobAccess(event("/f/legacy.md"), "legacy.md")
  for (const uploadedAt of [new Date(LEGACY_UPLOAD_CUTOFF), new Date(), new Date(NaN), undefined]) {
    state.objects.set("orphan.md", { uploadedAt })
    await missing(() => requireBlobAccess(event("/f/orphan.md"), "orphan.md"))
  }
  await missing(() => requireBlobAccess(event("/f/missing.md"), "missing.md"))
  sql.prepare("INSERT INTO blob_tombstones VALUES (?)").run("legacy.md")
  await missing(() => requireBlobAccess(event("/f/legacy.md"), "legacy.md"))
})

test("/api/me reads the maintained member counter after inserts and deletes", async () => {
  state.who = who
  assert.equal((await meHandler(event("/api/me"))).members, 1)
  sql.exec("INSERT INTO user (id, name, email) VALUES ('second', 'Second', 'second@example.com')")
  queries.length = 0
  const viewer = await meHandler(event("/api/me"))
  assert.equal(viewer.members, 2)
  assert.equal(viewer.team, true)
  assert.equal(queries.length, 1)
  assert.doesNotMatch(queries[0].query, /count\(/)
  sql.exec("DELETE FROM user WHERE id = 'second'")
  assert.equal((await meHandler(event("/api/me"))).members, 1)
})

test("app publishing keeps only the latest file set, as the docs promise", async () => {
  const first = await publishApp(who, { files: { "index.html": "first", "old.js": "old" } })
  const oldKeys = [...state.objects.keys()]
  const next = await publishApp(who, { id: first.id, files: { "index.html": "second", "new.js": "new" } })
  assert.equal(next.id, first.id)
  assert.equal(next.version, 2)
  assert.ok(oldKeys.every(key => !state.objects.has(key)))
  const detail = await dropDetail(await findDrop(first.id), who, "https://drop.example")
  assert.deepEqual(detail.files, { "index.html": "second", "new.js": "new" })
  assert.equal(detail.versions.length, 1)
  for (const path of ["README.md", "app/pages/docs/index.vue", "app/pages/docs/review.vue", "skills/vitehub-drop/SKILL.md"])
    assert.match(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), /[Aa]pps? keep only|[Oo]nly the latest app|[Aa]pps? keep (?:only )?their latest/)
})

test("new code images record an owner and become unavailable when they are banned", async () => {
  const result = await createCodeImage(event("/api/code", "POST"), who, { code: "const value = 1", format: "svg", scale: 4 })
  const key = new URL(result.url).pathname.slice(3)
  assert.equal(sql.prepare("SELECT owner_id FROM code_images WHERE blob_key = ?").get(key).owner_id, who.userId)
  await requireBlobAccess(event(`/f/${key}`), key)
  sql.exec("UPDATE user SET banned = 1")
  await missing(() => requireBlobAccess(event(`/f/${key}`), key))
})
