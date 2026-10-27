import assert from "node:assert/strict"
import { resolveCacheKeys } from "ocache"
import { beforeEach, test } from "vite-plus/test"
import { readFileSync } from "node:fs"
import { sql, queries, state, calls, migrate, reset, insertDrop, insertVersion, who, event } from "./harness.mjs"
const { createDocDrop, dropDetail, findDrop, findDropByBlob, listDrops, versionsOf, deleteDrop, publishApp } =
  await import("../../server/utils/drops.ts")
const { requireBlobAccess } = await import("../../server/utils/content-access.ts")
const { default: accessMiddleware } = await import("../../server/middleware/0.drop-access.ts")
const { default: markdownMiddleware } = await import("../../server/middleware/1.markdown-documents.ts")
const { default: detailHandler } = await import("../../server/api/drops/[id].get.ts")
const { default: meHandler } = await import("../../server/api/me.get.ts")
const { createCodeImage } = await import("../../server/utils/code-image-store.ts")

migrate()
beforeEach(reset)
const missing = (action) => assert.rejects(action, (error) => error.status === 404)

test("a drop's versions take one indexed query, at most 100 of them", async () => {
  insertDrop("doc", { version: 150 })
  for (let i = 1; i < 150; i++) insertVersion("doc", i)
  for (let i = 0; i < 500; i++) {
    insertDrop(`unrelated${i}`, { version: 2 })
    insertVersion(`unrelated${i}`, 1)
  }
  const row = await findDrop("doc")
  queries.length = 0
  const versions = await versionsOf(row)
  assert.equal(queries.length, 1)
  assert.equal(versions.length, 100)
  assert.equal(versions[0].version, 150)
  assert.equal(versions.at(-1).version, 51)
  const { query, params } = queries[0]
  const plan = sql
    .prepare(`EXPLAIN QUERY PLAN ${query}`)
    .all(...params)
    .map((row) => row.detail)
    .join("\n")
  assert.match(plan, /SEARCH drop_versions USING INDEX/)
  assert.doesNotMatch(plan, /SCAN drop_versions/)
})

test("listing reads the owner's newest drops through their index", async () => {
  for (let i = 0; i < 600; i++) insertDrop(`v${i}`, { updated_at: 2000 - i })
  for (let i = 0; i < 500; i++) insertDrop(`other${i}`, { owner_id: "other" })
  const rows = await listDrops(who)
  assert.equal(rows.length, 500)
  assert.equal(rows[0].id, "v0")
  const plan = sql
    .prepare(`EXPLAIN QUERY PLAN ${queries[0].query}`)
    .all(...queries[0].params)
    .map((row) => row.detail)
    .join("\n")
  assert.match(plan, /drops_owner_idx/)
  assert.doesNotMatch(plan, /SCAN drops\b/)
})

test("publishing from an older version's file still extends the latest version", async () => {
  insertDrop("doc", { version: 3 })
  insertVersion("doc", 1)
  insertVersion("doc", 2)
  insertDrop("unrelated", { version: 99 })
  const next = await createDocDrop(who, {
    filename: "plan.md",
    bytes: new TextEncoder().encode("# Fourth"),
    supersedes: "doc-v1.md",
  })
  assert.equal(next.id, "doc")
  assert.equal(next.version, 4)
  assert.deepEqual(
    (await versionsOf(await findDrop("doc"))).map((row) => row.version),
    [4, 3, 2, 1],
  )
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
  sql.prepare("INSERT INTO code_images VALUES (?, ?, ?, ?)").run(imageKey, "owner", 1, Date.now() + 300000)
  sql.exec("UPDATE user SET banned = 1 WHERE id = 'owner'")
  for (const path of [`/f/${key}`, `/f/${key}?raw`, `/f/${imageKey}`, "/f/apps/app/file.html", "/d/doc", "/d/app"])
    for (const method of ["GET", "HEAD", "POST"]) await missing(() => accessMiddleware(event(path, method)))
  // The address a share page settles on, with the doc's slug, passes the same gate.
  await missing(() => accessMiddleware(event("/d/doc/the-doc")))
  // A malformed escape is a 404 too, not an unhandled URIError.
  for (const path of ["/f/%E0%A4", "/d/%E0%A4", "/d/%E0%A4/slug"]) await missing(() => accessMiddleware(event(path)))
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
  sql.prepare("INSERT INTO code_images VALUES (?, ?, ?, ?)").run(imageKey, "owner", 1, Date.now() + 300000)
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

test("review policy reuses the owner join for IDs, blobs, pages and raw downloads", async () => {
  state.shareApproval = true
  insertDrop("doc", { share_review: "pending" })
  for (const lookup of [() => findDrop("doc", event("/d/doc")), () => findDropByBlob("doc.md", event("/f/doc.md"))]) {
    queries.length = 0
    assert.equal((await lookup()).shareReview, "pending")
    assert.equal(queries.length, 1)
  }
  await missing(() => requireBlobAccess(event("/f/doc.md?raw"), "doc.md"))
  for (const path of ["/d/doc", "/d/doc/the-doc"])
    await assert.rejects(accessMiddleware(event(path)), (error) => error.status === 403)
  for (const identity of [who, { ...who, userId: "admin", role: "admin" }]) {
    state.who = identity
    await requireBlobAccess(event("/f/doc.md"), "doc.md")
    await accessMiddleware(event("/d/doc"))
  }
  state.who = null
  for (const approval of [
    "UPDATE user SET share_approved_at = 1",
    "UPDATE user SET share_approved_at = NULL, role = 'admin'",
  ]) {
    sql.exec(approval)
    queries.length = 0
    await requireBlobAccess(event("/f/doc.md"), "doc.md")
    assert.equal(queries.length, 1)
    assert.equal((await findDrop("doc", event("/d/doc"))).shareReview, null)
    await accessMiddleware(event("/d/doc"))
  }
  sql.exec("UPDATE user SET banned = 1")
  await missing(() => accessMiddleware(event("/d/doc")))
  await missing(() => requireBlobAccess(event("/f/doc.md"), "doc.md"))
  sql.exec("UPDATE user SET banned = 0, role = NULL")
  state.shareApproval = false
  queries.length = 0
  await requireBlobAccess(event("/f/doc.md"), "doc.md")
  assert.equal(queries.length, 1)
  state.shareApproval = true
  sql.exec("UPDATE drops SET share_review = 'rejected'")
  await missing(() => requireBlobAccess(event("/f/doc.md"), "doc.md"))
})

test("quarantine and missing owners block warm renders, raw content, apps and pages for every caller", async () => {
  const key = "00000000-0000-4000-8000-000000000001.md"
  insertDrop("doc", { blob_key: key })
  insertDrop("app", { kind: "app", blob_key: null })
  await dropDetail(await findDrop("doc"), null, "https://drop.example")
  assert.ok(state.entries.size)
  const reads = calls.get
  for (const blocked of [
    "UPDATE drops SET quarantined_at = 1",
    "UPDATE drops SET quarantined_at = NULL, owner_id = 'deleted-owner'",
  ]) {
    sql.exec(blocked)
    for (const identity of [null, who, { ...who, role: "admin" }]) {
      state.who = identity
      for (const path of [`/f/${key}`, `/f/${key}?raw`, "/d/doc", "/d/app"])
        for (const method of ["GET", "HEAD", "POST"]) await missing(() => accessMiddleware(event(path, method)))
      await missing(() => markdownMiddleware(event(`/f/${key}`)))
      for (const id of ["doc", "app"])
        await missing(async () => dropDetail(await findDrop(id), identity, "https://drop.example"))
    }
  }
  assert.equal(calls.get, reads)
  assert.equal(calls.head, 0)
})

test("reports quarantine code images while image access stays one query", async () => {
  const imageKey = `code-images/${Date.now() + 300000}/image.svg`
  sql.prepare("INSERT INTO code_images VALUES (?, ?, ?, ?)").run(imageKey, "owner", 1, Date.now() + 300000)
  sql
    .prepare(
      "INSERT INTO abuse_reports (id, target, reason, details, status, created_at) VALUES (?, ?, 'spam', '', 'quarantined', 1)",
    )
    .run(imageKey, `/f/${imageKey}`)
  queries.length = 0
  await missing(() => requireBlobAccess(event(`/f/${imageKey}`), imageKey))
  assert.equal(queries.length, 1)
  assert.equal(calls.head, 0)
})

test("HTML keeps report controls outside the sandbox and HEAD emits no body", async () => {
  const key = "00000000-0000-4000-8000-000000000001.html"
  insertDrop("html", { kind: "html", blob_key: key })
  const response = await markdownMiddleware(event(`/f/${key}`))
  assert.ok(response.indexOf(">Report</a>") < response.indexOf("<iframe"))
  assert.match(response, /sandbox="allow-scripts/)
  assert.equal(await markdownMiddleware(event(`/f/${key}`, "HEAD")), "")
})

test("failed blob deletion never turns a private file public, and retries remove its cache", async () => {
  insertDrop("doc", { visibility: "private" })
  const row = await findDrop("doc")
  await dropDetail(row, who, "https://drop.example")
  const [cacheKey] = await resolveCacheKeys({
    options: { base: "", group: "nitro/functions", name: "markdown", getKey: () => "doc.md" },
  })
  state.entries.set(cacheKey, { value: "old html" })
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

test("a blob with no drop behind it is never served, and access needs no storage read", async () => {
  for (const uploadedAt of [new Date(0), new Date(), undefined]) {
    state.objects.set("orphan.md", { uploadedAt })
    await missing(() => requireBlobAccess(event("/f/orphan.md"), "orphan.md"))
  }
  await missing(() => requireBlobAccess(event("/f/missing.md"), "missing.md"))
  assert.equal(calls.head, 0)
})

test("/api/me does not count review shares for the removed sidebar badge", async () => {
  insertDrop("waiting", { share: "public", share_review: "pending" })
  insertDrop("waiting-comments", { share: "public_comment", share_review: "pending" })
  insertDrop("rejected", { share: "public", share_review: "rejected" })
  insertDrop("unlisted", { share: "private", share_review: "pending" })
  state.who = who
  assert.equal((await meHandler(event("/api/me"))).reviews, undefined)
  state.who = { ...who, role: "admin" }
  queries.length = 0
  assert.equal((await meHandler(event("/api/me"))).reviews, undefined)
  for (const { query } of queries) assert.doesNotMatch(query, /count\(/)
})

test("app publishing keeps only the latest file set, as the docs promise", async () => {
  const first = await publishApp(who, { files: { "index.html": "first", "old.js": "old", "keep.css": "a{}" } })
  const keys = () => [...state.objects.keys()]
  const firstKeys = keys()
  const keepKey = firstKeys.find((key) => key.endsWith("/keep.css"))
  const next = await publishApp(who, {
    id: first.id,
    files: { "index.html": "second", "new.js": "new" },
    removes: ["old.js"],
  })
  assert.equal(next.id, first.id)
  assert.equal(next.version, 2)
  // Replaced and removed files lose their blobs; the untouched one keeps its blob and isn't written again.
  assert.ok(firstKeys.filter((key) => key !== keepKey).every((key) => !state.objects.has(key)))
  assert.ok(state.objects.has(keepKey))
  const detail = await dropDetail(await findDrop(first.id), who, "https://drop.example")
  assert.deepEqual(detail.files, { "index.html": "second", "keep.css": "a{}", "new.js": "new" })
  assert.equal(detail.versions.length, 1)
  for (const path of ["content/docs/index.md", "content/docs/review.md", "skills/vitehub-drop/SKILL.md"])
    assert.match(
      readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"),
      /[Aa]pps? keeps? only|[Oo]nly the latest app|[Aa]pps? keeps? (?:only )?(?:their|its) latest/,
    )
})

test("an app's file path can't climb out of its folder through an escape the blob store decodes", async () => {
  const before = [...state.objects.keys()]
  for (const path of [
    "%2e%2e/%2e%2e/%2e%2e/victim.md",
    "a/%2E%2E/%2e%2e/b.js",
    "%252e%252e/x.js",
    "..%5c..%5cx.js",
    "a%2fb.js",
    "a%5cb.js",
    "a%252fb.js",
  ])
    await assert.rejects(
      publishApp(who, { files: { "index.html": "app", [path]: "x" } }),
      (error) => error.status === 400 && /Invalid file path/.test(error.message),
    )
  assert.deepEqual([...state.objects.keys()], before)
  // A name that only contains a percent sign still publishes.
  await publishApp(who, { files: { "index.html": "app", "100%.txt": "x" } })
})

test("an app's next version deletes a file only when removes names it", async () => {
  const app = await publishApp(who, { files: { "index.html": "one", "data.json": "{}" } })
  const before = [...state.objects.keys()]
  await assert.rejects(publishApp(who, { id: app.id, files: {}, removes: ["gone.js"] }), /gone\.js, which isn't in v1/)
  await assert.rejects(
    publishApp(who, { id: app.id, files: { "data.json": "[]" }, removes: ["data.json"] }),
    /removes and files both name data\.json/,
  )
  await assert.rejects(publishApp(who, { id: app.id, files: {}, removes: ["index.html"] }), /without an index\.html/)
  await assert.rejects(publishApp(who, { id: app.id, files: {} }), /Send the files that changed/)
  assert.deepEqual([...state.objects.keys()], before)
  const v2 = await publishApp(who, { id: app.id, files: { "index.html": "two" } })
  assert.equal(v2.version, 2)
  assert.deepEqual((await dropDetail(await findDrop(app.id), who, "https://drop.example")).files, {
    "data.json": "{}",
    "index.html": "two",
  })
  await publishApp(who, { id: app.id, files: {}, removes: ["data.json"] })
  assert.deepEqual((await dropDetail(await findDrop(app.id), who, "https://drop.example")).files, {
    "index.html": "two",
  })
})

test("new code images record an owner and become unavailable when they are banned", async () => {
  const result = await createCodeImage(event("/api/code", "POST"), who, {
    code: "const value = 1",
    format: "svg",
    scale: 4,
  })
  const key = new URL(result.url).pathname.slice(3)
  assert.equal(sql.prepare("SELECT owner_id FROM code_images WHERE blob_key = ?").get(key).owner_id, who.userId)
  await requireBlobAccess(event(`/f/${key}`), key)
  sql.exec("UPDATE user SET banned = 1")
  await missing(() => requireBlobAccess(event(`/f/${key}`), key))
})

test("quota publishing keeps share review and uses one owner burst bucket for docs, apps and images", async () => {
  state.quotasEnabled = true
  state.shareApproval = true
  const { getUsage, quotaToolResult } = await import("../../server/utils/quotas.ts")
  const first = await createDocDrop(
    who,
    { filename: "review.md", bytes: new TextEncoder().encode("# Review"), share: "public_comment" },
    event("/mcp", "POST"),
  )
  assert.equal(first.shareReview, "pending")
  assert.equal((await findDrop(first.id)).shareReview, "pending")
  assert.equal((await getUsage(who.userId)).writes.used, 1)
  await publishApp(who, { files: { "index.html": "app" } }, event("/mcp", "POST"))
  await createCodeImage(event("/mcp", "POST"), who, { code: "const x = 1", format: "svg", scale: 4 })
  assert.equal((await getUsage(who.userId)).writes.used, 3)
  assert.equal(state.bursts.filter((call) => call.bucket === "file-upload").length, 3)
  assert.ok(state.bursts.every((call) => call.key === who.userId))
  state.failBurst = true
  const result = await quotaToolResult(() =>
    createDocDrop(who, { filename: "denied.md", bytes: new TextEncoder().encode("denied") }, event("/mcp", "POST")),
  )
  assert.equal(result.isError, true)
  assert.equal(result.structuredContent.quota.unit, "burstPublishes")
  assert.equal((await getUsage(who.userId)).writes.used, 3)
})

test("cleanup releases image quota only after deleting its blob and retains OAuth cleanup", async () => {
  state.quotasEnabled = true
  const { default: cleanup } = await import("../../server/schedules/cleanup.ts")
  const { getUsage } = await import("../../server/utils/quotas.ts")
  const result = await createCodeImage(event("/mcp", "POST"), who, { code: "const x = 1", format: "svg", scale: 4 })
  const key = new URL(result.url).pathname.slice(3)
  assert.ok((await getUsage(who.userId)).bytes.used > 0)
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000)
  state.failDelete = true
  await assert.rejects(cleanup.handler({ scheduledAt }), /injected blob delete/)
  assert.ok((await getUsage(who.userId)).bytes.used > 0)
  assert.ok(sql.prepare("SELECT blob_key FROM code_images WHERE blob_key = ?").get(key))
  state.failDelete = false
  await cleanup.handler({ scheduledAt })
  assert.equal((await getUsage(who.userId)).bytes.used, 0)
  assert.equal((await getUsage(who.userId)).writes.used, 1)
  assert.ok(!state.objects.has(key))
  assert.equal(sql.prepare("SELECT count(*) AS n FROM code_images").get().n, 0)
})

test("full-history deletion queues every blob beyond the version display bounds", async () => {
  insertDrop("long", { version: 300 })
  for (let i = 1; i < 300; i++) insertVersion("long", i)
  state.failDelete = true
  await deleteDrop(await findDrop("long"))
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drops").get().n, 0)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drop_versions").get().n, 0)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM blob_cleanup").get().n, 300)
})
