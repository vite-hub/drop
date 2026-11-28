// The browser extension's notes routes, with Drop's real OAuth provider on the test database: the extension links
// with an access token for /api/review/notes, finds where it can comment, and trades the token for a review session.
import assert from "node:assert/strict"
import { createHash, randomBytes } from "node:crypto"
import { readdirSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { H3Event, toResponse } from "h3"
import { mcpOAuth } from "@vite-hub/auth/mcp"
import { beforeEach, test } from "vite-plus/test"
import { insertDrop, migrate, queries, reset, sql, state } from "../cost/harness.mjs"

const { default: schema } = await import("../../server/databases/default/index.ts")
const { dropOAuth } = await import("../../server/utils/oauth-resources.ts")
const { readReviewToken, signReviewToken } = await import("../../server/utils/review.ts")
const { getUsage } = await import("../../server/utils/quotas.ts")
const { presenceIdentity, presenceOrigin, presenceRoom } = await import("../../server/utils/presence.ts")
const { default: hello } = await import("../../server/api/review/notes/hello.get.ts")
const { default: notesIndex } = await import("../../server/api/review/notes/index/index.get.ts")
const { default: targets } = await import("../../server/api/review/notes/targets.post.ts")
const { default: session } = await import("../../server/api/review/notes/session.post.ts")
const { default: commentsGet } = await import("../../server/api/review/comments.get.ts")
const { default: relatedGet } = await import("../../server/api/review/related.get.ts")
const { default: presencePost } = await import("../../server/api/review/presence.post.ts")
const { default: membersOnly } = await import("../../server/middleware/0.2.members-only.ts")
const { default: agentsList } = await import("../../server/api/agents/index.get.ts")
const { default: agentDelete } = await import("../../server/api/agents/[id].delete.ts")

const DROP = "https://drop.example"
const SITE = "https://app.acme.example.com"
const OTHER = "https://docs.acme.example.com"
const chromeRedirect = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/"
const chromeOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"

migrate()
reset()
state.authSecret = "test-secret"

const auth = betterAuth({
  baseURL: DROP,
  secret: "test-only-secret-at-least-thirty-two-characters",
  database: drizzleAdapter(state.db, { provider: "sqlite", schema: schema.schema }),
  emailAndPassword: { enabled: true },
  plugins: [...mcpOAuth(dropOAuth(DROP))],
})
state.auth = auth

const call = (path, { body, form, cookie, from = DROP } = {}) =>
  auth.handler(
    new Request(`${DROP}/api/auth${path}`, {
      method: body || form ? "POST" : "GET",
      headers: {
        origin: from,
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      },
      body: body ? JSON.stringify(body) : form ? new URLSearchParams(form) : undefined,
    }),
  )

const signUp = await call("/sign-up/email", {
  body: { name: "Ada", email: "ada@example.com", password: "a-long-local-password" },
})
assert.equal(signUp.status, 200, await signUp.clone().text())
const cookie = signUp.headers
  .getSetCookie()
  .map((value) => value.split(";")[0])
  .join("; ")
const adaId = (await signUp.json()).user.id
const ada = {
  userId: adaId,
  name: "Ada",
  email: "ada@example.com",
  image: null,
  role: "member",
  actorKind: "browser",
  actorName: "Ada",
  teams: {},
}
state.identities = { [adaId]: ada }

const registered = await call("/oauth2/register", {
  from: chromeOrigin,
  body: {
    client_name: "Drop browser extension",
    redirect_uris: [chromeRedirect],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  },
})
assert.equal(registered.status, 201, await registered.clone().text())
const clientId = (await registered.json()).client_id

/** Authorization code + PKCE for `resource`, consented the first time, then exchanged at the token endpoint. */
async function link(resource) {
  const verifier = randomBytes(32).toString("base64url")
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: chromeRedirect,
    scope: "openid profile email offline_access",
    state: "notes",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource,
  })
  let back = new URL((await call(`/oauth2/authorize?${query}`, { cookie })).headers.get("location"), DROP)
  if (back.pathname === "/oauth") {
    const consent = await call("/oauth2/consent", { cookie, body: { accept: true, oauth_query: back.search.slice(1) } })
    assert.equal(consent.status, 200, await consent.clone().text())
    back = new URL((await consent.json()).url)
  }
  const code = back.searchParams.get("code")
  assert.ok(code, back.href)
  const issued = await call("/oauth2/token", {
    from: chromeOrigin,
    form: {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: chromeRedirect,
      resource,
    },
  })
  const body = await issued.json()
  assert.equal(issued.status, 200, JSON.stringify(body))
  return body.access_token
}

let notesToken = await link(`${DROP}/api/review/notes`)
const mcpToken = await link(`${DROP}/mcp`)

beforeEach(() => {
  sql.exec("DELETE FROM drops; DELETE FROM quota_reservations")
  state.who = null
  state.mode = "personal"
  state.members = ""
  state.quotasEnabled = false
  state.freeKept = 10
  delete state.contentOrigin
})

function request(path, { method = "GET", headers = {}, body, params = {} } = {}) {
  const event = new H3Event(new Request(`${DROP}${path}`, { method, headers, body }))
  event.context.log = { set() {}, error() {}, warn() {} }
  event.context.params = params
  return event
}
const bearer = (token = notesToken) => ({ authorization: `Bearer ${token}` })
const post = (path, body, token) =>
  request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...bearer(token) },
    body: JSON.stringify(body),
  })
async function answer(handler, event) {
  const value = await Promise.resolve()
    .then(() => handler(event))
    .catch((error) => error)
  return toResponse(value, event)
}
async function reply(handler, event) {
  const response = await answer(handler, event)
  const text = await response.text()
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null }
}
const openSession = (body, token) => reply(session, post("/api/review/notes/session", body, token))
const listTargets = (origin, token) => reply(targets, post("/api/review/notes/targets", { origin }, token))
const index = (headers = {}, token) =>
  reply(notesIndex, request("/api/review/notes/index", { headers: { ...bearer(token), ...headers } }))
const count = (where) => sql.prepare(`SELECT count(*) AS n FROM drops WHERE ${where}`).get().n
const writes = () => queries.filter(({ query }) => /^\s*(insert|update|delete)\b/i.test(query)).length

const review = (id, overrides = {}) =>
  insertDrop(id, {
    kind: "site",
    blob_key: null,
    owner_id: adaId,
    filename: "app.acme.example.com",
    site_url: SITE,
    visibility: "private",
    updated_at: Date.now(),
    ...overrides,
  })

test("hello says where this Drop is and what it calls itself, to anyone, with no CORS", async () => {
  const plain = await reply(hello, request("/api/review/notes/hello", { headers: { origin: chromeOrigin } }))
  assert.equal(plain.status, 200)
  assert.deepEqual(plain.body, { drop: DROP, name: "Drop", version: plain.body.version })
  assert.equal(typeof plain.body.version, "string")
  assert.equal(plain.headers.get("access-control-allow-origin"), null)
  state.contentOrigin = "https://*-usercontent.example.net"
  const content = await reply(hello, request("/api/review/notes/hello"))
  assert.equal(content.body.content, "https://*-usercontent.example.net")
  state.members = "ada@example.com"
  for (const route of ["hello", "index", "targets", "session"])
    assert.equal(await membersOnly(request(`/api/review/notes/${route}`)), undefined)
})

test("parallel connects make one notes folder and one notes drop, private and kept without a keep slot", async () => {
  state.mode = "team"
  state.quotasEnabled = true
  state.freeKept = 0
  const results = await Promise.all(
    Array.from({ length: 4 }, () => openSession({ origin: SITE, target: "notes", create: true })),
  )
  for (const result of results) assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(count("role = 'notes-folder'"), 1)
  assert.equal(count("role = 'notes'"), 1)
  const folder = sql.prepare("SELECT * FROM drops WHERE role = 'notes-folder'").get()
  const notes = sql.prepare("SELECT * FROM drops WHERE role = 'notes'").get()
  assert.equal(folder.title, "Browser notes")
  assert.equal(folder.parent_id, null)
  assert.equal(folder.share, "private")
  assert.equal(folder.lifetime, "keep")
  assert.equal(notes.parent_id, folder.id)
  assert.equal(notes.site_url, SITE)
  assert.equal(notes.share, "private")
  const drops = await Promise.all(results.map(({ body }) => readReviewToken(request("/"), body.token)))
  assert.deepEqual([...new Set(drops.map((claims) => claims.d))], [notes.id])
  assert.equal((await getUsage(adaId)).kept.used, 0)
  const { token, expiresAt, origin, title, name } = results[0].body
  assert.deepEqual({ origin, title, name }, { origin: SITE, title: "app.acme.example.com", name: "Ada" })
  assert.ok(expiresAt > Date.now() && expiresAt <= Date.now() + 300_000)
  assert.equal(typeof token, "string")
})

test("each exact origin gets its own notes drop in the same folder", async () => {
  assert.equal((await openSession({ origin: SITE, target: "notes", create: true })).status, 200)
  assert.equal((await openSession({ origin: OTHER, target: "notes", create: true })).status, 200)
  assert.equal(count("role = 'notes-folder'"), 1)
  assert.deepEqual(
    sql
      .prepare("SELECT site_url FROM drops WHERE role = 'notes' ORDER BY site_url")
      .all()
      .map((row) => row.site_url),
    [SITE, OTHER],
  )
})

test("without create, missing notes answer 404 and make nothing", async () => {
  const missing = await openSession({ origin: SITE, target: "notes" })
  assert.equal(missing.status, 404)
  assert.equal(count("1"), 0)
  assert.equal((await openSession({ origin: SITE, target: "notes", create: true })).status, 200)
  assert.equal((await openSession({ origin: SITE, target: "notes" })).status, 200)
  const refused = await openSession({ origin: SITE, target: "site", create: true })
  assert.equal(refused.status, 400)
})

test("targets lists the reviews covering the page first, then notes, and writes nothing", async () => {
  review("site", { title: "Acme app" })
  insertDrop("elsewhere", { kind: "site", blob_key: null, owner_id: adaId, site_url: OTHER, visibility: "private" })
  insertDrop("hidden", { kind: "site", blob_key: null, site_url: SITE, visibility: "private" })
  const before = writes()
  const listed = await listTargets(SITE)
  assert.equal(listed.status, 200)
  assert.deepEqual(listed.body.targets, [
    { id: "site", name: "Acme app", access: "private" },
    { id: "notes", name: "Browser notes", access: "private" },
  ])
  assert.equal(writes(), before)
  assert.equal(count("role IS NOT NULL"), 0)
})

test("targets and session refuse patterns, non-web origins and Drop's own pages", async () => {
  state.contentOrigin = "https://usercontent.example.net"
  for (const origin of [
    "https://*.acme.example.com",
    "chrome-extension://abc",
    `${SITE}/path`,
    DROP,
    "https://usercontent.example.net",
  ]) {
    assert.equal((await listTargets(origin)).status, 400, origin)
    assert.equal((await openSession({ origin, target: "notes", create: true })).status, 400, origin)
  }
  assert.equal(count("1"), 0)
})

test("a review session opens on a review the person may comment on, never someone else's notes", async () => {
  review("site")
  const opened = await openSession({ origin: SITE, target: "site" })
  assert.equal(opened.status, 200)
  const claims = await readReviewToken(request("/"), opened.body.token)
  assert.equal(claims.d, "site")
  assert.equal(claims.x, 1)
  assert.equal((await openSession({ origin: OTHER, target: "site" })).status, 404)
  insertDrop("theirs", { kind: "site", blob_key: null, site_url: SITE, visibility: "team" })
  state.mode = "team"
  assert.equal((await openSession({ origin: SITE, target: "theirs" })).status, 200)
  insertDrop("their-notes", { kind: "site", blob_key: null, site_url: SITE, visibility: "team", role: "notes" })
  assert.equal((await openSession({ origin: SITE, target: "their-notes" })).status, 404)
})

test("index lists notes origins and commentable reviews, answers 304 to its ETag, and writes nothing", async () => {
  review("site")
  review("pattern", { site_url: "https://*.preview.acme.example.com" })
  insertDrop("hidden", { kind: "site", blob_key: null, site_url: "https://hidden.example.com", visibility: "private" })
  assert.equal((await openSession({ origin: OTHER, target: "notes", create: true })).status, 200)
  const before = writes()
  const first = await index()
  assert.equal(first.status, 200)
  assert.deepEqual(first.body, { origins: ["https://*.preview.acme.example.com", SITE, OTHER] })
  const etag = first.headers.get("etag")
  assert.match(etag, /^"[0-9a-f]{64}"$/)
  assert.match(first.headers.get("cache-control"), /no-cache/)
  const again = await index({ "if-none-match": etag })
  assert.equal(again.status, 304)
  assert.equal(again.headers.get("etag"), etag)
  assert.equal(writes(), before)
  review("later", { site_url: "https://later.example.com" })
  assert.equal((await index({ "if-none-match": etag })).status, 200)
})

test("notes routes take only notes tokens, and a notes token opens nothing else", async () => {
  for (const token of [mcpToken, "not-a-token", ""]) {
    assert.equal((await index({}, token)).status, 401)
    assert.equal((await listTargets(SITE, token)).status, 401)
    assert.equal((await openSession({ origin: SITE, target: "notes", create: true }, token)).status, 401)
  }
  assert.equal(count("1"), 0)
  const dist = "node_modules/@vite-hub/auth/dist"
  const chunk = readdirSync(dist).find((name) => /^mcp-token-[\w-]+\.js$/.test(name))
  const { verifyAppAccessToken } = Object.values(await import(pathToFileURL(join(dist, chunk)).href)).find(
    (value) => typeof value?.verifyAppAccessToken === "function",
  )
  for (const path of ["/mcp", "/api/drops", "/api/me"]) {
    const [error] = await verifyAppAccessToken(notesToken, DROP, new URL(`${DROP}${path}`), auth)
    assert.equal(error?.data?.reason, "wrong_resource", path)
  }
  const [mcpError] = await verifyAppAccessToken(mcpToken, DROP, new URL(`${DROP}/mcp`), auth)
  assert.equal(mcpError, undefined)
})

test("an extension's review token works with no Origin or its own, and gets no CORS headers", async () => {
  review("site", { visibility: "private" })
  const { token } = (await openSession({ origin: SITE, target: "site" })).body
  for (const headers of [{}, { origin: chromeOrigin }, { origin: SITE }]) {
    const listed = await answer(
      commentsGet,
      request("/api/review/comments?page=/", { headers: { ...headers, authorization: `Bearer ${token}` } }),
    )
    assert.equal(listed.status, 200, JSON.stringify(headers))
    assert.equal(listed.headers.get("access-control-allow-origin"), null)
    const related = await answer(
      relatedGet,
      request("/api/review/related", { headers: { ...headers, authorization: `Bearer ${token}` } }),
    )
    assert.equal(related.status, 200)
    assert.equal(related.headers.get("access-control-allow-origin"), null)
  }
  const ticket = await reply(
    presencePost,
    request("/api/review/presence", { method: "POST", headers: { authorization: `Bearer ${token}` } }),
  )
  assert.equal(ticket.status, 200, JSON.stringify(ticket.body))
  const room = await presenceRoom(request("/"), { id: "site" })
  assert.equal(ticket.body.room, room)
  for (const origin of [chromeOrigin, SITE, "https://elsewhere.example.com"]) {
    const socket = () =>
      request(`/_vitehub/realtime/presence/${room}?ticket=${encodeURIComponent(ticket.body.ticket)}`, {
        headers: { origin, upgrade: "websocket" },
      })
    const made = socket()
    assert.equal(await presenceOrigin(made, made.req, origin), true, origin)
    assert.deepEqual(await presenceIdentity(made, made.req), { id: adaId, name: "Ada" })
  }
})

test("a review token without the extension claim still needs its page's Origin, as before", async () => {
  review("site")
  const { token } = await signReviewToken(request("/"), { d: "site", u: adaId, n: "Ada", o: SITE })
  assert.equal((await readReviewToken(request("/"), token)).x, undefined)
  const get = (headers) =>
    answer(
      commentsGet,
      request("/api/review/comments?page=/", { headers: { ...headers, authorization: `Bearer ${token}` } }),
    )
  const own = await get({ origin: SITE })
  assert.equal(own.status, 200)
  assert.equal(own.headers.get("access-control-allow-origin"), SITE)
  assert.equal((await get({})).status, 401)
  assert.equal((await get({ origin: chromeOrigin })).status, 401)
  const ticket = await reply(
    presencePost,
    request("/api/review/presence", { method: "POST", headers: { origin: SITE, authorization: `Bearer ${token}` } }),
  )
  assert.equal(ticket.status, 200)
  const room = await presenceRoom(request("/"), { id: "site" })
  const socket = (origin) =>
    request(`/_vitehub/realtime/presence/${room}?ticket=${encodeURIComponent(ticket.body.ticket)}`, {
      headers: { origin, upgrade: "websocket" },
    })
  const fromSite = socket(SITE)
  assert.equal(await presenceOrigin(fromSite, fromSite.req, SITE), true)
  const fromExtension = socket(chromeOrigin)
  assert.equal(await presenceOrigin(fromExtension, fromExtension.req, chromeOrigin), false)
  const expires = (await readReviewToken(request("/"), token)).e
  assert.ok(expires > Date.now() + 3_600_000, "A page's own review token keeps its 12 hours")
})

test("Connected agents names the extension, and disconnecting it ends its notes access at once", async () => {
  state.who = ada
  const listed = await agentsList(request("/api/agents"))
  const extension = listed.find((row) => row.name === "Browser extension")
  assert.ok(extension, JSON.stringify(listed))
  assert.equal((await listTargets(SITE)).status, 200)
  assert.deepEqual(
    await agentDelete(request(`/api/agents/${extension.id}`, { method: "DELETE", params: { id: extension.id } })),
    { ok: true },
  )
  assert.equal((await openSession({ origin: SITE, target: "notes", create: true })).status, 401)
  assert.equal((await index()).status, 401)
  assert.equal(count("1"), 0)
  notesToken = await link(`${DROP}/api/review/notes`)
  assert.equal((await listTargets(SITE)).status, 200)
})
