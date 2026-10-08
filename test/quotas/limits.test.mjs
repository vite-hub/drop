import assert from "node:assert/strict"
import { test } from "node:test"
import { DatabaseSync } from "node:sqlite"
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { Worker } from "node:worker_threads"
import { toStandardJsonSchema } from "@valibot/to-json-schema"
import * as v from "valibot"
import { H3Event, HTTPError, toResponse } from "h3"
import { createMcpHandler, defineMcpTool } from "nitro-mcp-toolkit"
import { MCP_LATEST, MCP_LEGACY } from "../../shared/mcp.ts"
import { MIB, planLimits, quotaFailure, quotaToolFailure, usageNearLimit } from "../../shared/quotas.ts"
import { reserveSQL, usageSQL } from "../../server/utils/quota-sql.ts"

function setup(path = ":memory:") {
  const db = new DatabaseSync(path)
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000")
  for (const name of ["0000_init", "0001_security_constraints", "0002_oauth_provider", "0004_quotas"])
    db.exec(readFileSync(new URL(`../../server/databases/migrations/${name}.sql`, import.meta.url), "utf8"))
  return db
}
function reserve(db, { owner = "owner", month = "2026-10", drops = 1, bytes = 10, writes = 1, target = null, limits = planLimits("free") } = {}) {
  const id = crypto.randomUUID()
  const row = db.prepare(reserveSQL).get(owner, month, id, drops, bytes, writes, target, Date.now(),
    limits.drops === null ? 0 : 1, drops, limits.drops ?? 0,
    limits.bytes === null ? 0 : 1, bytes, limits.bytes ?? 0,
    limits.writes === null ? 0 : 1, writes, limits.writes ?? 0)
  return row ? id : null
}
function doc(db, id, { size = 10, previous = null, owner = "owner", kind = "markdown" } = {}) {
  db.prepare(`INSERT INTO drops (id, owner_id, kind, title, filename, size, supersedes_id, actor_kind, actor_name, created_at, updated_at) VALUES (?, ?, ?, 'Doc', 'doc.md', ?, ?, 'browser', 'Tester', 0, 0)`).run(id, owner, kind, size, previous)
}
function commit(db, id, operation, success = true) {
  db.exec("BEGIN")
  try {
    operation()
    db.prepare("UPDATE quota_reservations SET committed=1, drops=0, bytes=0, writes=CASE WHEN ? THEN writes ELSE -1 END WHERE id=?").run(Number(success), id)
    db.exec("COMMIT")
  }
  catch (error) { db.exec("ROLLBACK"); throw error }
}
const used = (db, owner = "owner", month = "2026-10") => ({ ...db.prepare(usageSQL).get(owner, month) })

test("plans, warnings, and non-retryable agent guidance", () => {
  assert.deepEqual(planLimits("free"), { drops: 3, bytes: 100 * MIB, writes: 1000, appFiles: 50, appBytes: 2 * MIB })
  assert.equal(planLimits("pro").bytes, 1024 * MIB)
  assert.equal(planLimits("pro", { writes: 234 }).writes, 234)
  assert.equal(planLimits("unlimited").drops, null)
  const body = quotaFailure("drops", 3, 3)
  assert.equal(body.retryable, false)
  assert.match(body.message, /Nothing was created or changed/)
  assert.match(quotaToolFailure(body).content[0].text, /Ask the user/)
  assert.match(quotaToolFailure(body).content[0].text, /Do not retry or delete/)
  assert.equal(body.upgradeUrl, "/settings/billing")
  assert.equal(body.selfHostUrl, "/docs/self-host")
  const usage = { enabled: true, drops: { used: 2, limit: 3 }, bytes: { used: 0, limit: 100 * MIB }, writes: { used: 0, limit: 1000 } }
  assert.equal(usageNearLimit(usage), true)
  assert.equal(usageNearLimit({ ...usage, enabled: false }), false)
  assert.equal(usageNearLimit({ ...usage, drops: { used: 1, limit: 3 } }), false)
  assert.equal(usageNearLimit({ ...usage, drops: { used: 1, limit: 3 }, bytes: { used: 80 * MIB, limit: 100 * MIB } }), true)
})

test("three logical drops allow revisions, count all retained versions, and deletion frees capacity", () => {
  const db = setup()
  for (let i = 0; i < 3; i++) {
    const id = reserve(db)
    assert.ok(id)
    commit(db, id, () => doc(db, `doc${i}`))
  }
  assert.equal(reserve(db), null)
  const revision = reserve(db, { drops: 0, bytes: 20, target: "doc0" })
  commit(db, revision, () => doc(db, "revision", { previous: "doc0", size: 20 }))
  assert.deepEqual(used(db), { drops: 3, bytes: 50, writes: 4 })
  db.exec("DELETE FROM drops WHERE id IN ('doc0', 'revision')")
  assert.deepEqual(used(db), { drops: 2, bytes: 20, writes: 4 })
  assert.ok(reserve(db))
  db.close()
})

test("storage and writes reserve exact boundaries, with per-owner and UTC month isolation", () => {
  const db = setup()
  const id = reserve(db, { bytes: 100 * MIB, writes: 1000 })
  assert.ok(id)
  assert.equal(reserve(db, { drops: 0, bytes: 1, writes: 0 }), null)
  assert.equal(reserve(db, { drops: 0, bytes: 0 }), null)
  assert.ok(reserve(db, { owner: "other" }))
  commit(db, id, () => doc(db, "full", { size: 100 * MIB }))
  assert.ok(reserve(db, { month: "2026-11", drops: 0, bytes: 0 }))
  assert.equal(used(db, "owner", "2026-11").writes, 1)
  db.close()
})

test("failed metadata batch and failed storage leave no monthly charges or new drop", () => {
  const db = setup()
  const id = reserve(db)
  assert.throws(() => commit(db, id, () => doc(db, "failed"), false), /CHECK constraint/)
  assert.equal(db.prepare("SELECT count(*) AS n FROM drops").get().n, 0)
  db.prepare("DELETE FROM quota_reservations WHERE id=? AND committed=0").run(id)
  assert.deepEqual(used(db), { drops: 0, bytes: 0, writes: 0 })
  const failedStorage = reserve(db)
  db.prepare("DELETE FROM quota_reservations WHERE id=? AND committed=0").run(failedStorage)
  assert.deepEqual(used(db), { drops: 0, bytes: 0, writes: 0 })
  db.close()
})

test("app files count once, replacement counts writes and only storage growth, pending publishes serialize", () => {
  const db = setup()
  doc(db, "app", { kind: "app", size: 999 })
  db.exec("INSERT INTO drop_files (drop_id,path,blob_key,size) VALUES ('app','index.html','old',20)")
  assert.equal(used(db).bytes, 20)
  const id = reserve(db, { drops: 0, bytes: 10, writes: 2, target: "app" })
  assert.throws(() => reserve(db, { drops: 0, target: "app" }), /UNIQUE constraint/)
  commit(db, id, () => {
    db.exec("DELETE FROM drop_files WHERE drop_id='app'")
    db.exec("INSERT INTO drop_files (drop_id,path,blob_key,size) VALUES ('app','index.html','new',15), ('app','style.css','css',15)")
  })
  assert.deepEqual(used(db), { drops: 1, bytes: 30, writes: 2 })
  assert.ok(reserve(db, { drops: 0, bytes: 0, target: "app" }))
  db.close()
})

test("downgraded owners can revise without growing storage or adding slots", () => {
  const db = setup()
  for (let i = 0; i < 5; i++) doc(db, `old${i}`, { size: 30 * MIB })
  assert.equal(reserve(db), null)
  assert.ok(reserve(db, { drops: 0, bytes: 0 }))
  assert.equal(reserve(db, { drops: 0, bytes: 1 }), null)
  db.close()
})

test("unlimited plans reserve beyond free and Pro caps without imposing owner limits", () => {
  const db = setup()
  const limits = planLimits("unlimited")
  for (let i = 0; i < 5; i++) {
    const id = reserve(db, { limits, bytes: 2 * 1024 * MIB, writes: 20_000 })
    assert.ok(id)
    commit(db, id, () => doc(db, `big${i}`, { size: 2 * 1024 * MIB }))
  }
  assert.deepEqual(used(db), { drops: 5, bytes: 10 * 1024 * MIB, writes: 100_000 })
  db.close()
})

test("temporary code images charge a write and bytes until blob cleanup, with no drop", () => {
  const db = setup()
  const id = reserve(db, { drops: 0, bytes: 15 })
  commit(db, id, () => db.exec("INSERT INTO quota_blobs (blob_key,owner_id,size,expires_at) VALUES ('code-images/old/image.svg','owner',15,0)"))
  assert.deepEqual(used(db), { drops: 0, bytes: 15, writes: 1 })
  db.exec("DELETE FROM quota_blobs WHERE blob_key='code-images/old/image.svg'")
  assert.deepEqual(used(db), { drops: 0, bytes: 0, writes: 1 })
  db.close()
})

test("concurrent SQLite clients cannot reserve more than three slots or the remaining write budget", async () => {
  const directory = mkdtempSync(join(homedir(), ".cache/fleet/tmp/drop-quota-test-"))
  const path = join(directory, "quotas.sqlite")
  const db = setup(path)
  const source = `const { parentPort, workerData } = require('node:worker_threads'); const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(workerData.path); db.exec('PRAGMA busy_timeout=10000'); const row = db.prepare(workerData.query).get(...workerData.values); db.close(); parentPort.postMessage(Boolean(row));`
  const race = (drops, bytes, writes, dropLimit, byteLimit, writeLimit) => Promise.all(Array.from({ length: 12 }, () => new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: { path, query: reserveSQL, values: ['owner', '2026-10', crypto.randomUUID(), drops, bytes, writes, null, Date.now(), 1, drops, dropLimit, 1, bytes, byteLimit, 1, writes, writeLimit] } })
    worker.once('message', resolve); worker.once('error', reject)
  })))
  try {
    assert.equal((await race(1, 1, 1, 3, 100, 1000)).filter(Boolean).length, 3)
    db.exec("DELETE FROM quota_reservations")
    assert.equal((await race(0, 0, 2, 100, 100, 5)).filter(Boolean).length, 2)
    db.exec("DELETE FROM quota_reservations")
    assert.equal((await race(0, 4, 0, 100, 10, 1000)).filter(Boolean).length, 2)
  }
  finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
})

for (const version of [MCP_LATEST, ...MCP_LEGACY]) {
  test(`quota failures are normal tool results with structured content over MCP ${version}`, async () => {
    const failure = quotaFailure("writes", 1000, 1000)
    const handler = createMcpHandler({ name: "quota-test", version: "1", origin: false, tools: [defineMcpTool({ name: "denied", inputSchema: toStandardJsonSchema(v.object({})), handler: async () => quotaToolFailure(failure) })] })
    const params = { name: "denied", arguments: {}, ...(version === MCP_LATEST ? { _meta: { "io.modelcontextprotocol/protocolVersion": version, "io.modelcontextprotocol/clientInfo": { name: "quota-test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } : {}) }
    const event = new H3Event(new Request("https://drop.example/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": version, "mcp-method": "tools/call", "mcp-name": "denied" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params }) }))
    const response = await toResponse(await handler(event), event)
    assert.equal(response.status, 200)
    const body = await response.text()
    const json = JSON.parse(body.startsWith("event:") ? body.match(/^data: (.+)$/m)[1] : body)
    assert.equal(json.error, undefined)
    assert.equal(json.result.isError, true)
    assert.deepEqual(json.result.structuredContent, failure)
    assert.match(json.result.content[0].text, /Ask the user/)
  })
}

test("REST quota errors preserve the same top-level JSON fields with 402", async () => {
  const failure = quotaFailure("drops", 3, 3)
  const event = new H3Event(new Request("https://drop.example/api/drops"))
  const response = await toResponse(new HTTPError({ status: 402, message: failure.message, body: { ...failure } }), event)
  assert.equal(response.status, 402)
  const body = await response.json()
  for (const [key, value] of Object.entries(failure)) assert.deepEqual(body[key], value)
})
