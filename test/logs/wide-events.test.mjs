import assert from "node:assert/strict"
import { beforeEach, test, vi } from "vite-plus/test"
import { H3Event } from "h3"
import { insertDrop, migrate, reset, sql, state, who } from "../cost/harness.mjs"

// Drop's own identity module, with Better Auth's session lookup answering for the test (test/stubs.ts `authApi`).
const session = { current: null }
state.authApi = {
  getSession: async () => {
    if (session.current instanceof Error) throw session.current
    return session.current
  },
}
vi.mock("nitro/runtime-config", () => ({ useRuntimeConfig: () => ({ deployment: { host: "vps" } }) }))

const { evlogOptions } = await import("../../scripts/logging.ts")
// evlog's Nitro module hands its options to the server as JSON; the plugin reads them back from here.
process.env.__EVLOG_CONFIG = JSON.stringify(evlogOptions({ version: "1.2.3", commit: "abc1234" }))
const { default: evlogPlugin } = await import("../../node_modules/evlog/dist/nitro/v3/plugin.mjs")
const { default: wideEvents } = await import("../../server/plugins/wide-events.ts")
const { identify } = await import("../../server/utils/identity.ts")
const { default: patchDrop } = await import("../../server/api/drops/[id].patch.ts")
const { default: deleteDropRoute } = await import("../../server/api/drops/[id].delete.ts")
const { default: upload } = await import("../../server/api/uploads/[ticket].put.ts")
const { default: cleanup } = await import("../../server/schedules/cleanup.ts")
const { default: report } = await import("../../server/api/reports.post.ts")
const { mcpFor } = await import("../../server/mcp/index.ts")

/** A Nitro app's hooks, enough for evlog's plugin and Drop's. */
const listeners = new Map()
const app = {
  hooks: {
    hook(name, listener) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener])
    },
    async callHook(name, ...args) {
      for (const listener of listeners.get(name) ?? []) await listener(...args)
    },
  },
}
/** evlog's plugin, as in production: each event is printed as one JSON line, the way a host's log shows it. */
async function startEvlog(target) {
  process.env.NODE_ENV = "production"
  await evlogPlugin(target)
  process.env.NODE_ENV = "test"
}
await startEvlog(app)
await wideEvents(app)
const events = []
app.hooks.hook("evlog:drain", ({ event }) => {
  events.push(event)
})
// Events outside a request (the hourly schedule) have no drain here: what's printed is what the host's log gets.
const background = []
const warnings = []
function printed(line) {
  try {
    const event = JSON.parse(line)
    if (!("method" in event)) background.push(event)
  } catch {
    warnings.push(String(line))
  }
}

/** One request through evlog's request, response, and error hooks: the wide event it emitted. */
async function request(path, handler, { method = "GET", body, params, headers = {} } = {}) {
  const json = body !== undefined && typeof body !== "string"
  const event = new H3Event(
    new Request(`https://drop.example${path}`, {
      method,
      headers: { ...headers, ...(json ? { "content-type": "application/json" } : {}) },
      ...(body === undefined ? {} : { body: json ? JSON.stringify(body) : body }),
    }),
  )
  if (params) event.context.params = params
  const before = events.length
  await app.hooks.callHook("request", event)
  let failure
  try {
    const result = await handler(event)
    await app.hooks.callHook("response", new Response(JSON.stringify(result ?? null)), event)
  } catch (error) {
    failure = error
    await app.hooks.callHook("error", error, { event })
  }
  // An error's event is enriched and drained after the hook returns.
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(events.length, before + 1, "one wide event per request")
  return { event: events.at(-1), failure }
}

migrate()
beforeEach(() => {
  reset()
  session.current = null
  state.mcpCaller = null
  state.authSecret = undefined
  background.length = 0
  warnings.length = 0
  for (const method of ["log", "info", "warn", "error"]) vi.spyOn(console, method).mockImplementation(printed)
})

test("every event names the release and the host it ran on", async () => {
  const { event } = await request("/api/me", () => ({ ok: true }))
  assert.equal(event.service, "drop")
  assert.equal(event.version, "1.2.3")
  assert.equal(event.commitHash, "abc1234")
  assert.deepEqual(event.deployment, { host: "vps" })
})

test("the health check and static files leave no event", async () => {
  for (const path of ["/api/health", "/_nuxt/entry.js", "/og.png", "/agents/claude.svg"]) {
    const before = events.length
    const event = new H3Event(new Request(`https://drop.example${path}`))
    await app.hooks.callHook("request", event)
    await app.hooks.callHook("response", new Response("ok"), event)
    assert.equal(events.length, before, path)
  }
})

test("a write names its drop and what it changed; a lookup of another drop doesn't replace it", async () => {
  state.who = who
  insertDrop("plan", { visibility: "private" })
  insertDrop("folder", { kind: "folder", blob_key: null, filename: "", visibility: "private" })
  const { event } = await request("/api/drops/plan", patchDrop, {
    method: "PATCH",
    params: { id: "plan" },
    body: { title: "New plan", folder: "folder" },
  })
  assert.equal(event.drop.id, "plan")
  assert.equal(event.drop.kind, "markdown")
  assert.equal(event.drop.change, "update")
  assert.deepEqual(event.drop.fields, ["title", "folder"])

  const gone = await request("/api/drops/plan", deleteDropRoute, { method: "DELETE", params: { id: "plan" } })
  assert.equal(gone.event.drop.id, "plan")
  assert.equal(gone.event.drop.change, "trash")
})

test("an upload URL's ticket never reaches the log", async () => {
  state.authSecret = "test-auth-secret"
  const ticket = "Fe26.2**sealed-ticket-that-stands-in-for-a-sign-in**0123456789abcdef"
  const { event, failure } = await request(`/api/uploads/${ticket}`, upload, {
    method: "PUT",
    body: "bytes",
    params: { ticket },
  })
  assert.equal(failure.status, 403)
  assert.equal(event.path, "/api/uploads/[REDACTED]")
  assert.ok(!JSON.stringify(event).includes("sealed-ticket"), JSON.stringify(event))
})

test("an upload URL quoted in an error's text loses its ticket, and the event stays whole", async () => {
  const { event } = await request("/api/me", () => {
    throw new Error('Upload failed: "https://drop.example/api/uploads/Fe26.2**sealed-ticket**abc" answered 500')
  })
  assert.equal(event.error.message, 'Upload failed: "https://drop.example/api/uploads/[REDACTED]" answered 500')
  assert.deepEqual(event.deployment, { host: "vps" })
})

test("an event outside a request is redacted too and names the host", async () => {
  const { logError } = await import("../../server/utils/logs.ts")
  logError(undefined, new Error('fetch "https://drop.example/api/uploads/sealed-ticket" from 2001:db8::7'), {
    action: "test",
  })
  const [event] = background
  assert.deepEqual(event.deployment, { host: "vps" })
  assert.ok(!JSON.stringify(event).includes("sealed-ticket"), JSON.stringify(event))
  assert.ok(!JSON.stringify(event).includes("2001:db8"))
})

test("an IPv6 address in an error never reaches the log", async () => {
  const { event } = await request("/api/me", () => {
    throw new Error("connect ECONNREFUSED 2001:db8:85a3::8a2e:370:7334")
  })
  assert.match(event.error.message, /ECONNREFUSED \[REDACTED\]/)
  assert.ok(!JSON.stringify(event).includes("2001:db8"))
})

test("a person in the browser is their id on the event, never their name; an agent keeps its client's name", async () => {
  session.current = {
    user: { id: "owner", name: "Ada Realname", email: "owner@example.com", emailVerified: true, banned: false },
  }
  const { event } = await request("/api/me", identify)
  assert.deepEqual(event.actor, { kind: "browser" })
  assert.equal(event.user.id, "owner")
  assert.ok(!JSON.stringify(event).includes("Realname"), JSON.stringify(event))

  state.mcpCaller = {
    user: { id: "owner", name: "Ada Realname", email: "owner@example.com", emailVerified: true },
    clientName: "Claude Code",
  }
  const agent = await request("/mcp", identify, { headers: { authorization: "Bearer token" } })
  assert.deepEqual(agent.event.actor, { kind: "agent", name: "Claude Code" })
  assert.ok(!JSON.stringify(agent.event).includes("Realname"))

  // A refused token is signed out, and does not fall back to the browser session; the event says which check failed.
  state.mcpCaller = null
  const refused = await request("/mcp", identify, { headers: { authorization: "Bearer token" } })
  assert.deepEqual(refused.event.token, { rejected: "invalid token" })
  assert.equal(refused.event.user, undefined)
})

test("a refused or failed session says why on the event, and the request is still signed out", async () => {
  session.current = { user: { id: "owner", name: "Ada", email: "owner@example.com", banned: true } }
  const banned = await request("/api/me", identify)
  assert.equal(banned.event.auth.denied, "banned")
  assert.equal(banned.event.user, undefined)

  session.current = new Error("D1 is unavailable")
  const failed = await request("/api/me", identify)
  assert.equal(failed.event.level, "error")
  assert.equal(failed.event.error.message, "D1 is unavailable")
  assert.equal(failed.event.auth.session, "failed")

  // A GitHub membership outage still answers 503, not signed out.
  session.current = Object.assign(new Error("GitHub is down"), { body: { code: "AUTH_GITHUB_UNAVAILABLE" } })
  const outage = await request("/api/me", identify)
  assert.equal(outage.failure.status, 503)
})

test("an agent accepted by ViteHub after its ban expires is not denied by Drop", async () => {
  state.mcpCaller = {
    user: { id: "owner", name: "Ada", email: "owner@example.com", banned: true, banExpires: new Date(0) },
    clientName: "Claude Code",
  }
  const agent = await request("/mcp", identify, { headers: { authorization: "Bearer token" } })
  assert.equal(agent.event.user?.id, "owner")
  assert.deepEqual(agent.event.actor, { kind: "agent", name: "Claude Code" })
})

test("the hourly cleanup emits one event a run, with each step's count, and names the step that failed", async () => {
  const now = Date.UTC(2026, 10, 17, 12)
  vi.useFakeTimers({ toFake: ["Date"], now })
  insertDrop("old", { trashed_at: now - 16 * 86_400_000, trash_reason: "deleted" })
  sql
    .prepare("INSERT INTO code_images (blob_key, owner_id, size, expires_at) VALUES (?, ?, ?, ?)")
    .run("code-images/expired.png", "owner", 10, now - 1)
  state.failDelete = true
  await assert.rejects(cleanup.handler({ scheduledAt: new Date(now) }))
  const runs = background.filter((event) => event.schedule === "cleanup")
  assert.equal(runs.length, 1)
  const [run] = runs
  assert.equal(run.level, "error")
  assert.equal(run.version, "1.2.3")
  assert.deepEqual(run.deployment, { host: "vps" })
  assert.deepEqual(run.failed, ["codeImages"])
  assert.match(run.steps.codeImages.error, /injected blob delete failure/)
  assert.equal(run.steps.drops.purged, 1)
  assert.deepEqual(run.steps.drops.deleted, [{ id: "old", owner: "owner", reason: "deleted" }])
  assert.equal(typeof run.steps.drops.ms, "number")
  assert.equal(run.steps.quotaReservations.released, 0)
})

test("an abuse report is an audit, kept when info events are sampled out", async () => {
  insertDrop("shared", { visibility: "shared" })
  const config = process.env.__EVLOG_CONFIG
  const parsed = JSON.parse(config)
  process.env.__EVLOG_CONFIG = JSON.stringify({ ...parsed, sampling: { ...parsed.sampling, rates: { info: 0 } } })
  await startEvlog({ hooks: { hook() {} } })
  try {
    const before = events.length
    const plain = new H3Event(new Request("https://drop.example/api/me"))
    await app.hooks.callHook("request", plain)
    await app.hooks.callHook("response", new Response("null"), plain)
    assert.equal(events.length, before, "a plain request is sampled out")

    const { event } = await request("/api/reports", report, {
      method: "POST",
      body: { target: "/d/shared", reason: "spam", details: "Spam", email: "reporter@example.com" },
    })
    assert.equal(event.level, "info", "a report isn't an error")
    assert.equal(event.audit.action, "report.create")
    assert.deepEqual(event.audit.actor, { type: "user", id: "anonymous" })
    assert.equal(event.audit.target.type, "report")
    assert.equal(event.audit.target.drop, "shared")
    assert.ok(!JSON.stringify(event).includes("reporter@example.com"))
  } finally {
    process.env.__EVLOG_CONFIG = config
    await startEvlog({ hooks: { hook() {} } })
  }
})

test("each tool call in an MCP batch keeps its own entry and drop", async () => {
  state.who = { ...who, actorKind: "agent", actorName: "Claude Code" }
  insertDrop("first", { visibility: "private" })
  insertDrop("second", { visibility: "private" })
  const { mcp } = mcpFor("https://drop.example")
  const call = (id, drop) => ({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "read_drop", arguments: { id: drop } },
  })
  const { event } = await request(
    "/mcp",
    async (event) => {
      const response = await mcp(event)
      assert.equal(response.status, 200, await response.clone().text())
      return response.text()
    },
    {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-03-26",
      },
      body: [call(1, "first"), call(2, "second")],
    },
  )
  assert.deepEqual(
    event.mcp.calls.map((entry) => [entry.tool, entry.drop, entry.isError]),
    [
      ["read_drop", "first", false],
      ["read_drop", "second", false],
    ],
  )
})

test("a purge that fails halfway still lists the drops the run deleted", async () => {
  const now = Date.UTC(2026, 10, 17, 12)
  vi.useFakeTimers({ toFake: ["Date"], now })
  for (const id of ["first", "second"])
    insertDrop(id, { trashed_at: now - 16 * 86_400_000, trash_reason: "deleted", blob_key: null })
  sql.exec(`CREATE TRIGGER fail_second BEFORE DELETE ON drops WHEN old.id = 'second'
    BEGIN SELECT RAISE(ABORT, 'second is stuck'); END`)
  try {
    await assert.rejects(cleanup.handler({ scheduledAt: new Date(now) }), /second is stuck/)
  } finally {
    sql.exec("DROP TRIGGER fail_second")
  }
  const run = background.find((event) => event.schedule === "cleanup")
  assert.deepEqual(run.failed, ["drops"])
  assert.deepEqual(run.steps.drops.deleted, [{ id: "first", owner: "owner", reason: "deleted" }])
})

test("a spreadsheet that can't be read logs once, and is read again after five minutes", async () => {
  const { renderSpreadsheetCached } = await import("../../server/utils/spreadsheet.ts")
  const now = Date.UTC(2026, 10, 17, 12)
  vi.useFakeTimers({ toFake: ["Date"], now })
  let reads = 0
  const bytes = async () => {
    reads++
    return new TextEncoder().encode("not a workbook")
  }
  const open = () =>
    request("/f/sheet.xlsx", async (event) => renderSpreadsheetCached("sheets/broken.xlsx", ".xlsx", bytes, event))
  const first = await open()
  assert.equal(first.event.level, "error")
  assert.equal(first.event.blobKey, "sheets/broken.xlsx")
  const second = await open()
  assert.equal(reads, 1, "kept for now")
  assert.notEqual(second.event.level, "error")
  vi.advanceTimersByTime(6 * 60_000)
  await open()
  assert.equal(reads, 2, "read again once the five minutes are over")
})

test("an admin's Better Auth call is audited with its outcome; one that only reads is not", async () => {
  const { default: adminApi } = await import("../../server/middleware/0.18.admin-api.ts")
  state.who = { ...who, role: "admin" }
  const call = (endpoint, status, answer = null, body = { userId: "member" }) =>
    request(`/api/auth/admin/${endpoint}`, (event) => adminApi(event, async () => new Response(answer, { status })), {
      method: "POST",
      body,
    })
  const missing = await call("ban-user", 404)
  assert.equal(missing.event.audit.action, "auth-admin.ban-user")
  assert.equal(missing.event.audit.outcome, "failure")
  assert.deepEqual(missing.event.audit.target, { type: "user", id: "member" })
  assert.equal((await call("ban-user", 200)).event.audit.outcome, "success")
  assert.equal((await call("has-permission", 200)).event.audit, undefined)
  assert.equal((await call("list-user-sessions", 200)).event.audit, undefined)
  // An endpoint Drop doesn't know yet is audited rather than missed.
  assert.equal((await call("some-new-endpoint", 200)).event.audit.action, "auth-admin.some-new-endpoint")
  const created = await call("create-user", 200, JSON.stringify({ user: { id: "new-user" } }), {
    email: "a@example.com",
  })
  assert.deepEqual(created.event.audit.target, { type: "user", id: "new-user" })
  assert.equal((await call("ban-user", 200, "{}")).event.audit.outcome, "success")
})

test("a webhook that cancels and updates a subscription lists both, and audits the cancellation", async () => {
  const { logSubscription } = await import("../../server/utils/teams.ts")
  const { authRequest } = await import("../../server/utils/logs.ts")
  const subscription = { id: "sub_1", referenceId: "team-1", plan: "team", status: "active", seats: 3 }
  const { event } = await request("/api/auth/stripe/webhook", (event) =>
    authRequest.run(event, async () => {
      await logSubscription("canceling")({ subscription })
      await logSubscription("updated")({ subscription })
    }),
  )
  assert.deepEqual(event.stripe.subscription.changes, ["canceling", "updated"])
  assert.equal(event.audit.action, "billing.canceling")
  assert.deepEqual(event.audit.actor, { type: "system", id: "stripe" })
})

test("a realtime room says why it refused someone", async () => {
  const { default: latest } = await import("../../server/realtime/latest.ts")
  const { event } = await request("/_vitehub/realtime/latest/gone", (event) =>
    latest.authorize({ event, documentId: "gone", mode: "read" }),
  )
  assert.deepEqual(event.realtime, { reason: "not-found" })
})

test("a missing drop's page adds nothing to its request's event, which is already out", async () => {
  const { default: contentError } = await import("../../server/handlers/content-error.ts")
  insertDrop("plan", { visibility: "private" })
  const { HTTPError } = await import("h3")
  const { failure } = await request("/d/plan/missing", () => {
    throw new HTTPError({ status: 404 })
  })
  const event = new H3Event(new Request("https://drop.example/d/plan/missing"))
  await app.hooks.callHook("request", event)
  await app.hooks.callHook("error", failure, { event })
  await new Promise((resolve) => setImmediate(resolve))
  await contentError(failure, event)
  assert.deepEqual(
    warnings.filter((line) => line.includes("after the wide event was emitted")),
    [],
  )
})
