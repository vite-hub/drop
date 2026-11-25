import assert from "node:assert/strict"
import { betterAuth } from "better-auth"
import { APIError } from "better-auth/api"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { admin } from "better-auth/plugins"
import { createRequestLogger } from "evlog"
import { H3, H3Event } from "h3"
import { afterEach, beforeEach, test, vi } from "vite-plus/test"
import { migrate, queries, reset, roundTrips, sql, state } from "../cost/harness.mjs"

const { default: schema } = await import("../../server/databases/default/index.ts")
const { oneSignInAtATime, proxyAuth } = await import("../../server/utils/proxy-auth.ts")
const { identify } = await import("../../server/utils/identity.ts")
const { authRequest } = await import("../../server/utils/logs.ts")
const { isProxyMember, readAuthProxyConfig } = await import("../../server/utils/proxy-auth-config.ts")
const { default: proxySession } = await import("../../server/middleware/0.15.proxy-session.ts")
vi.mock("nitro/runtime-config", () => ({ useRuntimeConfig: () => ({}) }))
const { default: signInStart } = await import("../../server/routes/signin/start.get.ts")

migrate()
beforeEach(() => {
  reset()
  state.authProxy = true
  state.members = "github-org:example-org"
})
afterEach(() => {
  vi.unstubAllGlobals()
  state.authProxy = false
  state.members = ""
  state.authProxyCookie = ""
  delete state.auth
  delete state.authApi
})

test("proxy sign-in requires a GitHub organization when VITEHUB_MEMBERS is unset", () => {
  delete state.members
  assert.throws(readAuthProxyConfig, /DROP_AUTH_PROXY requires a github-org:<organization> entry in VITEHUB_MEMBERS/)
})

function github(
  membership = () => Response.json({ state: "active" }),
  profile = () => Response.json({ id: 42, login: "maxi", name: "Maxi", email: "maxi@example.com" }),
  emails = () => Response.json([{ email: "maxi@example.com", primary: true, verified: true }]),
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.pathname.startsWith("/user/memberships/")) return membership()
      if (url.pathname === "/user") return profile()
      if (url.pathname === "/user/emails") return emails()
      throw new Error(`Unexpected GitHub request: ${url}`)
    }),
  )
}

function withCookies(event) {
  const headers = new Headers(event.req.headers)
  const pairs = (event.context.dropSessionCookies ?? []).map((cookie) => cookie.split(";")[0])
  if (pairs.length) headers.set("cookie", pairs.join("; "))
  return headers
}

const startRequest = (token) =>
  new Request("https://drop.example/signin/start?redirect=%2Freview%2Fconnect", {
    headers: { "x-auth-request-access-token": token },
  })

function connect(token) {
  return proxySession(new H3Event(startRequest(token)))
}

/** The response a browser gets when the middleware refuses it, through h3's error handling. */
const app = new H3().use(proxySession).get("/signin/start", () => "signed in")

const unavailable = "GITHUB_MEMBERSHIP_UNAVAILABLE"
for (const [label, upstream, status, message, code] of [
  [
    "expired token",
    () => Response.json({ message: "Bad credentials" }, { status: 401 }),
    401,
    /sign in again/i,
    "GITHUB_REAUTH_REQUIRED",
  ],
  [
    "missing scope",
    () => Response.json({}, { status: 403, headers: { "x-oauth-scopes": "user:email" } }),
    403,
    /read:org/i,
    "GITHUB_ORG_ACCESS_REQUIRED",
  ],
  ["GitHub outage", () => Response.json({}, { status: 502 }), 503, /try again/i, unavailable],
  [
    "rate limit",
    () => Response.json({}, { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
    503,
    /try again/i,
    unavailable,
  ],
  [
    "network failure",
    () => {
      throw new TypeError("fetch failed")
    },
    503,
    /try again/i,
    unavailable,
  ],
  ["invalid response", () => Response.json({ unexpected: true }), 503, /try again/i, unavailable],
]) {
  test(`review connection distinguishes ${label} from non-membership, and says its code`, async () => {
    github(upstream)
    await assert.rejects(connect(`test-${label}`), (error) => {
      assert.equal(error.status, status)
      assert.match(error.message, message)
      assert.equal(error.data?.code, code)
      return true
    })
    const browser = await app.fetch(startRequest(`test-browser-${label}`))
    assert.equal(browser.status, status)
    assert.equal((await browser.json()).data?.code, code)
    const response = await signIn(auth(), `test-api-${label}`)
    assert.equal(response.status, status)
    const body = await response.json()
    assert.match(body.message, message)
    assert.equal(body.code, code)
  })
}

function signIn(instance, token) {
  return instance.handler(
    new Request("https://drop.example/api/auth/get-session", {
      headers: { "x-auth-request-access-token": token },
    }),
  )
}

function auth(databaseHooks = {}, advanced) {
  return betterAuth({
    baseURL: "https://drop.example",
    secret: "test-only-secret-at-least-thirty-two-characters",
    database: drizzleAdapter(state.db, { provider: "sqlite", schema: schema.schema }),
    databaseHooks,
    advanced,
    plugins: [proxyAuth(), admin()],
  })
}

const identityUnavailable = "GITHUB_IDENTITY_UNAVAILABLE"
for (const [label, profile, status, message, code] of [
  [
    "revoked token",
    () => Response.json({ message: "Bad credentials" }, { status: 401 }),
    401,
    /sign in again/i,
    "GITHUB_REAUTH_REQUIRED",
  ],
  ["GitHub outage", () => Response.json({}, { status: 502 }), 503, /try again/i, identityUnavailable],
  ["rate limit", () => Response.json({}, { status: 429 }), 503, /try again/i, identityUnavailable],
  ["malformed identity", () => Response.json({ login: "maxi" }), 503, /try again/i, identityUnavailable],
  [
    "network failure",
    () => {
      throw new TypeError("fetch failed")
    },
    503,
    /try again/i,
    identityUnavailable,
  ],
]) {
  test(`proxy sign-in reports ${label} during identity lookup after caching membership`, async () => {
    const token = `test-cached-profile-${label}`
    github()
    assert.equal(await isProxyMember(token), true)
    const membership = vi.fn(() => assert.fail("The successful membership check should be cached"))
    github(membership, profile)
    const instance = auth()
    state.auth = instance
    const response = await signIn(instance, token)
    assert.equal(response.status, status)
    const body = await response.json()
    assert.match(body.message, message)
    assert.equal(body.code, code)
    await assert.rejects(connect(token), (error) => error.status === status && error.data?.code === code)
    assert.equal(membership.mock.calls.length, 0)
    assert.equal(sql.prepare("SELECT count(*) AS n FROM user WHERE id <> 'owner'").get().n, 0)
    assert.equal(sql.prepare("SELECT count(*) AS n FROM account").get().n, 0)
    assert.equal(sql.prepare("SELECT count(*) AS n FROM session").get().n, 0)
  })
}

for (const [label, publicEmail, emails, email, emailVerified] of [
  [
    "primary private email",
    null,
    () =>
      Response.json([
        { email: "secondary@example.com", primary: false, verified: true },
        { email: "primary@example.com", primary: true, verified: true },
      ]),
    "primary@example.com",
    true,
  ],
  [
    "unverified public email",
    "public@example.com",
    () => Response.json([{ email: "primary@example.com", primary: true, verified: true }]),
    "public@example.com",
    false,
  ],
  ["unavailable email lookup", null, () => Response.json({}, { status: 503 }), "42@users.noreply.github.com", false],
]) {
  test(`proxy sign-in preserves profile mapping for ${label}`, async () => {
    github(
      undefined,
      () =>
        Response.json({
          id: 42,
          login: "maxi",
          name: null,
          email: publicEmail,
          avatar_url: "https://example.com/avatar",
        }),
      emails,
    )
    const response = await signIn(auth(), `test-profile-${label}`)
    assert.equal(response.status, 200, await response.text())
    const user = sql.prepare("SELECT name, email, email_verified, image FROM user WHERE id <> 'owner'").get()
    assert.equal(user.name, "maxi")
    assert.equal(user.email, email)
    assert.equal(Boolean(user.email_verified), emailVerified)
    assert.equal(user.image, "https://example.com/avatar")
  })
}

test("a cached grant for one GitHub organization does not grant access to another", async () => {
  github()
  assert.equal(await isProxyMember("test-org-cache"), true)
  state.members = "github-org:another-org"
  github(() => Response.json({}, { status: 404 }))
  assert.equal(await isProxyMember("test-org-cache"), false)
})

test("proxy sign-in runs Better Auth user and account creation hooks", async () => {
  github()
  const created = []
  const instance = auth({
    user: {
      create: {
        after: async (user) => {
          created.push(["user", user.id])
        },
      },
    },
    account: {
      create: {
        after: async (account) => {
          created.push(["account", account.userId])
        },
      },
    },
  })
  const response = await signIn(instance, "test-hooks")
  assert.equal(response.status, 200, await response.text())
  assert.equal(created.length, 2, "Both lifecycle hooks run")
  assert.equal(created[0][1], created[1][1])
  const session = await instance.api.getSession({
    headers: new Headers({
      cookie: response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    }),
  })
  assert.equal(session.user.email, "maxi@example.com")
  assert.equal(session.user.emailVerified, true)
  state.auth = instance
  const event = new H3Event(
    new Request("https://drop.example/signin/start", {
      headers: { "x-auth-request-access-token": "test-hooks-refreshed" },
    }),
  )
  await proxySession(event)
  const refreshed = await instance.api.getSession({ headers: withCookies(event) })
  assert.equal(refreshed.user.id, session.user.id, "A refreshed proxy token retains the existing GitHub identity")
  assert.equal(
    sql.prepare("SELECT access_token FROM account WHERE account_id='42'").get().access_token,
    "test-hooks-refreshed",
  )
  const sessions = sql.prepare("SELECT count(*) AS n FROM session").get().n
  await proxySession(event)
  assert.equal(
    sql.prepare("SELECT count(*) AS n FROM session").get().n,
    sessions,
    "An unchanged proxy token reuses its session",
  )
  sql.prepare("UPDATE user SET banned=1 WHERE id=?").run(session.user.id)
  sql.prepare("DELETE FROM session WHERE user_id=?").run(session.user.id)
  await assert.rejects(
    connect("test-banned"),
    (error) => error.status === 403 && error.data?.code === "BANNED_USER",
    "The Better Auth admin plugin refuses a banned user, and its code reaches the client",
  )
  for (const membership of [() => Response.json({}, { status: 404 }), () => Response.json({ state: "pending" })]) {
    github(membership)
    await assert.rejects(
      connect(crypto.randomUUID()),
      (error) => error.status === 403 && /membership required/i.test(error.message),
    )
  }
})

test("proxy sign-in works when the request's headers are immutable, as on Deno", async () => {
  github()
  state.auth = auth()
  class ImmutableHeaders extends Headers {
    set() {
      throw new TypeError("immutable")
    }
    append() {
      throw new TypeError("immutable")
    }
    delete() {
      throw new TypeError("immutable")
    }
  }
  const request = new Request("https://drop.example/signin/start")
  Object.defineProperty(request, "headers", {
    value: new ImmutableHeaders({ "x-auth-request-access-token": "test-immutable" }),
    configurable: true,
  })
  const event = new H3Event(request)
  await proxySession(event)
  const response = await auth().handler(
    new Request("https://drop.example/api/auth/get-session", { headers: event.req.headers }),
  )
  const session = await response.json()
  assert.equal(session?.user.email, "maxi@example.com", "The same request sees the new session")
  const cookies = [...event.context.dropSessionCookies, ...response.headers.getSetCookie()]
  assert.equal(cookies.filter((cookie) => cookie.includes("session_token=")).length, 1)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM session").get().n, 1, "Later lookups reuse the session")
  const signOut = await auth().handler(
    new Request("https://drop.example/api/auth/sign-out", {
      method: "POST",
      headers: { origin: "https://drop.example", cookie: withCookies(event).get("cookie") },
    }),
  )
  assert.equal(signOut.status, 200)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM session").get().n, 0)
})

test("request session reads write the GitHub account only when its token rotates", async () => {
  github()
  state.members += ",maxi@example.com"
  const first = await signIn(auth(), "test-unchanged-token")
  assert.equal(first.status, 200)
  const cookie = first.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")
  for (const [token, expectedWrites] of [
    ["test-unchanged-token", 0],
    ["test-rotated-token", 1],
    ["test-rotated-token", 0],
  ]) {
    const start = queries.length
    state.auth = auth()
    state.authApi = auth().api
    const event = new H3Event(
      new Request("https://drop.example/signin/start", {
        headers: { cookie, "x-auth-request-access-token": token },
      }),
    )
    await proxySession(event)
    assert.equal((await identify(event))?.email, "maxi@example.com")
    assert.equal(queries.slice(start).filter(({ query }) => /^update "account"/i.test(query)).length, expectedWrites)
    assert.equal(sql.prepare("SELECT access_token FROM account WHERE account_id='42'").get().access_token, token)
  }
})

/** The proxy handoff of a browser, under the request store that server/middleware/0.01.auth-request.ts sets. */
async function handoff(token) {
  const event = new H3Event(startRequest(token))
  event.context.log = createRequestLogger()
  const failure = await authRequest.run(event, () => proxySession(event)).catch((error) => error)
  return { failure, logged: event.context.log.getContext() }
}

test("a Better Auth user policy rejection leaves no proxy user or account, and says why", async () => {
  github()
  state.auth = auth({ user: { create: { before: async () => false } } })
  const { failure, logged } = await handoff("test-rejected")
  assert.equal(failure.status, 403)
  assert.equal(failure.data?.code, "PROXY_SIGN_IN_FAILED")
  assert.deepEqual(logged.auth, {
    signIn: "proxy failed",
    cause: "Better Auth refused the forwarded identity",
    proxy: { refused: "unable_to_create_user" },
  })
  assert.equal(sql.prepare("SELECT count(*) AS n FROM user WHERE email='maxi@example.com'").get().n, 0)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM account WHERE account_id='42'").get().n, 0)
})

test("a proxy identity whose unverified email belongs to another user is logged as account_not_linked", async () => {
  github(undefined, undefined, () => Response.json([{ email: "maxi@example.com", primary: true, verified: false }]))
  sql.exec(
    `INSERT INTO user (id, name, email, email_verified, role) VALUES ('local', 'Local', 'maxi@example.com', 1, 'member')`,
  )
  state.auth = auth()
  const { failure, logged } = await handoff("test-unlinked")
  assert.equal(failure.data?.code, "PROXY_SIGN_IN_FAILED")
  assert.deepEqual(logged.auth.proxy, { refused: "account_not_linked" })
  assert.ok(!JSON.stringify(logged).includes("maxi@example.com"), "The log names no email")
  assert.ok(!JSON.stringify(logged).includes("test-unlinked"), "The log names no token")
})

test("a session hook that denies the proxy identity is logged as denied, with the hook's code", async () => {
  github()
  state.auth = auth({
    session: {
      create: {
        before: async () => {
          throw new APIError("FORBIDDEN", { code: "AUTH_NOT_MEMBER", message: "Not a member" })
        },
      },
    },
  })
  const { failure, logged } = await handoff("test-denied")
  assert.equal(failure.status, 403)
  assert.deepEqual(logged.auth.proxy, { refused: "denied", denied: "AUTH_NOT_MEMBER" })
})

test("parallel first proxy sign-ins provision one account through Better Auth hooks", async () => {
  github()
  const created = []
  const instance = auth({
    account: {
      create: {
        after: async (account) => {
          created.push(account.id)
        },
      },
    },
  })
  const responses = await Promise.all(Array.from({ length: 2 }, () => signIn(instance, "test-parallel")))
  assert.deepEqual(
    responses.map((response) => response.status),
    [200, 200],
  )
  assert.equal(created.length, 1)
})

test("browsers that sign in separately as one GitHub user keep separate sessions", async () => {
  github()
  const cookieOf = (response) =>
    response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ")
  const first = cookieOf(await signIn(auth(), "test-browser-a"))
  const second = cookieOf(await signIn(auth(), "test-browser-b"))
  assert.notEqual(first, second)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM user WHERE id <> 'owner'").get().n, 1)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM session").get().n, 2)
  const signOut = await auth().handler(
    new Request("https://drop.example/api/auth/sign-out", {
      method: "POST",
      headers: { origin: "https://drop.example", cookie: first },
    }),
  )
  assert.equal(signOut.status, 200)
  const kept = await auth().api.getSession({ headers: new Headers({ cookie: second }) })
  assert.equal(kept?.user.email, "maxi@example.com", "Signing out one browser keeps the other's session")
})

test("overlapping first proxy requests through separate auth instances provision one user", async () => {
  github()
  Object.defineProperty(state, "auth", { get: () => auth(), configurable: true })
  const events = Array.from(
    { length: 2 },
    () =>
      new H3Event(
        new Request("https://drop.example/signin/start", {
          headers: { "x-auth-request-access-token": "test-overlap" },
        }),
      ),
  )
  await roundTrips(() => Promise.all(events.map((event) => proxySession(event))))
  assert.equal(sql.prepare("SELECT count(*) AS n FROM user WHERE id <> 'owner'").get().n, 1)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM account WHERE account_id = '42'").get().n, 1)
  for (const event of events) assert.match(event.req.headers.get("cookie") ?? "", /session_token=/)
})

test.each([false, true])("overlapping proxy refusals reach both logs (throws: %s)", async (throws) => {
  github()
  let attempts = 0
  const before = async () => {
    attempts++
    if (throws) throw new APIError("FORBIDDEN", { code: "AUTH_NOT_MEMBER", message: "Not a member" })
    return false
  }
  state.auth = auth(throws ? { session: { create: { before } } } : { user: { create: { before } } })
  const token = `test-overlap-refusal-${throws}`
  const requests = await Promise.all([handoff(token), handoff(token)])
  assert.equal(attempts, 1)
  const refusal = throws ? { refused: "denied", denied: "AUTH_NOT_MEMBER" } : { refused: "unable_to_create_user" }
  for (const { failure, logged } of requests) {
    assert.equal(failure.status, 403)
    assert.equal(failure.data?.code, throws ? "AUTH_NOT_MEMBER" : "PROXY_SIGN_IN_FAILED")
    assert.deepEqual(logged.auth?.proxy, refusal)
  }
})

test("two requests of one browser that arrive together get one session", async () => {
  github()
  assert.equal((await signIn(auth(), "test-same-browser")).status, 200)
  sql.prepare("DELETE FROM session").run()
  Object.defineProperty(state, "auth", { get: () => auth(), configurable: true })
  const events = Array.from({ length: 2 }, () => new H3Event(startRequest("test-same-browser")))
  for (const event of events) event.req.headers.set("cookie", "__Host-drop-auth=proxy-cookie")
  await Promise.all(events.map((event) => proxySession(event)))
  assert.equal(sql.prepare("SELECT count(*) AS n FROM session").get().n, 1)
  const [first, second] = events.map(
    (event) => event.context.dropSessionCookies?.find((cookie) => cookie.includes("session_token="))?.split(";")[0],
  )
  assert.match(first ?? "", /session_token=/)
  assert.equal(second, first)
})

test("overlapping requests with and without a Drop cookie keep separate sessions", async () => {
  github()
  const token = "test-mixed-cookies"
  const newAuth = () => auth({}, { useSecureCookies: false, cookiePrefix: "__Host-drop" })
  const started = await signIn(newAuth(), token)
  assert.equal(started.status, 200)
  const existingCookie = started.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("__Host-drop.session_token="))
  assert.ok(existingCookie)
  const existingPair = existingCookie.split(";")[0]
  Object.defineProperty(state, "auth", { get: newAuth, configurable: true })

  const request = startRequest(token)
  request.headers.set("cookie", existingPair)
  const existing = new H3Event(request)
  const fresh = new H3Event(startRequest(token))
  await Promise.all([proxySession(existing), proxySession(fresh)])

  assert.equal(existing.req.headers.get("cookie"), existingPair)
  assert.equal(existing.context.dropSessionCookies, undefined)
  assert.match(fresh.req.headers.get("cookie") ?? "", /__Host-drop\.session_token=/)
  assert.notEqual(fresh.req.headers.get("cookie"), existingPair)
  for (const event of [existing, fresh]) {
    assert.equal(event.req.headers.get("x-auth-request-access-token"), null)
    assert.equal((await newAuth().api.getSession({ headers: event.req.headers }))?.user.email, "maxi@example.com")
  }
  assert.equal(sql.prepare("SELECT count(*) AS n FROM session").get().n, 2)
})

test("browsers of a proxy member who already has an account don't wait on each other", async () => {
  github()
  assert.equal((await signIn(auth(), "test-concurrent-reads")).status, 200)
  let started = 0
  let open
  const gate = new Promise((resolve) => {
    open = resolve
  })
  const reads = ["test-concurrent-reads-a", "test-concurrent-reads-b"].map((token) =>
    oneSignInAtATime(token, async () => {
      started++
      await gate
    }),
  )
  await vi.waitFor(() => assert.equal(started, 2))
  open()
  await Promise.all(reads)
})

test("using another account signs the first one out of Drop before the second signs in", async () => {
  github()
  state.authProxyCookie = "__Host-drop-auth"
  const instance = auth()
  state.auth = instance
  const first = new H3Event(
    new Request("https://drop.example/signin/start", {
      headers: { "x-auth-request-access-token": "test-switch-first" },
    }),
  )
  await proxySession(first)
  const firstUser = sql.prepare("SELECT id FROM user WHERE email = 'maxi@example.com'").get().id
  assert.equal(sql.prepare("SELECT count(*) AS n FROM session WHERE user_id = ?").get(firstUser).n, 1)

  const signOut = new H3Event(
    new Request("https://drop.example/api/auth/sign-out", {
      method: "POST",
      headers: {
        origin: "https://drop.example",
        cookie: `${withCookies(first).get("cookie")}; __Host-drop-auth=proxy-ticket`,
        "x-auth-request-access-token": "test-switch-first",
        "x-drop-proxy-sign-out-handoff": "1",
      },
    }),
  )
  await proxySession(signOut)
  const response = await instance.handler(signOut.req)
  assert.equal(response.status, 200)
  const cookies = [...signOut.res.headers.getSetCookie(), ...response.headers.getSetCookie()]
  assert.ok(
    cookies.every((cookie) => !cookie.startsWith("__Host-drop-auth=")),
    "The proxy keeps its session ticket",
  )
  assert.equal(sql.prepare("SELECT count(*) AS n FROM session WHERE user_id = ?").get(firstUser).n, 0)

  github(
    undefined,
    () => Response.json({ id: 43, login: "other", name: "Other", email: "other@example.com" }),
    () => Response.json([{ email: "other@example.com", primary: true, verified: true }]),
  )
  const second = new H3Event(
    new Request("https://drop.example/signin/start", {
      headers: { "x-auth-request-access-token": "test-switch-second" },
    }),
  )
  await proxySession(second)
  const session = await instance.api.getSession({ headers: withCookies(second) })
  assert.equal(session?.user.email, "other@example.com")
  assert.deepEqual(
    sql
      .prepare("SELECT user_id FROM session")
      .all()
      .map((row) => row.user_id),
    [session.user.id],
  )
})

test("an expired proxy token can still sign out through Better Auth", async () => {
  github(() => Response.json({ message: "Bad credentials" }, { status: 401 }))
  state.authProxyCookie = "__Host-drop-auth"
  const instance = auth()
  state.auth = instance
  const event = new H3Event(
    new Request("https://drop.example/api/auth/sign-out", {
      method: "POST",
      headers: { origin: "https://drop.example", "x-auth-request-access-token": "test-logout-expired" },
    }),
  )
  await proxySession(event)
  assert.match(event.res.headers.get("set-cookie"), /__Host-drop-auth=;.*Max-Age=0/)
  const response = await instance.handler(event.req)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).success, true)
  for (const path of ["/signin", "/api/sign-in"])
    await proxySession(
      new H3Event(
        new Request(`https://drop.example${path}`, {
          headers: { "x-auth-request-access-token": "test-logout-expired" },
        }),
      ),
    )
  assert.equal(fetch.mock.calls.length, 0, "Recovery routes do not depend on the rejected GitHub token")
})

test("without proxy mode, the forwarded header signs nobody in", async () => {
  github()
  state.authProxy = false
  const instance = auth()
  state.auth = instance
  const event = new H3Event(
    new Request("https://drop.example/signin/start", {
      headers: { "x-auth-request-access-token": "test-proxy-off" },
    }),
  )
  await proxySession(event)
  assert.equal(event.context.dropSessionCookies, undefined)
  const response = await signIn(instance, "test-proxy-off")
  assert.equal(await response.json(), null)
  assert.equal(response.headers.getSetCookie().length, 0)
  assert.equal(fetch.mock.calls.length, 0, "Drop never asks GitHub about an untrusted header")
  assert.equal(sql.prepare("SELECT count(*) AS n FROM user WHERE id <> 'owner'").get().n, 0)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM session").get().n, 0)
})

// The proxy only guards /signin/start, so on any other path the header may come from the client itself.
test("the forwarded header signs nobody in outside /signin/start", async () => {
  github()
  state.auth = auth()
  for (const path of [
    "/api/drops",
    "/api/me",
    "/api/auth/get-session",
    "/d/abc",
    "/review/connect",
    "/signin",
    "/api/sign-in",
  ]) {
    const event = new H3Event(
      new Request(`https://drop.example${path}`, { headers: { "x-auth-request-access-token": "test-forged" } }),
    )
    await proxySession(event)
    assert.equal(event.req.headers.get("x-auth-request-access-token"), null, path)
    assert.equal(event.context.dropSessionCookies, undefined, path)
  }
  // nginx routes `/signin\start` past its guarded location, and Node's URL parser then reads it as /signin/start.
  const request = new Request("https://drop.example/signin/start", {
    headers: { "x-auth-request-access-token": "test-forged" },
  })
  request.runtime = { name: "node", node: { req: { url: "/signin\\start" } } }
  const event = new H3Event(request)
  await proxySession(event)
  assert.equal(event.req.headers.get("x-auth-request-access-token"), null)
  assert.equal(event.context.dropSessionCookies, undefined)
  assert.equal(fetch.mock.calls.length, 0, "Drop never asks GitHub about a header outside sign-in")
  assert.equal(sql.prepare("SELECT count(*) AS n FROM session").get().n, 0)
})

for (const [label, started, status] of [
  ["an error response", () => Response.json({ message: "Provider not found" }, { status: 404 }), 404],
  ["a response it can't read", () => new Response("<html>", { status: 200 }), 200],
]) {
  test(`a sign-in start that gets ${label} still goes back to the sign-in page, and the log says why`, async () => {
    state.authProxy = false
    state.auth = { api: { signInSocial: async () => started() } }
    const event = new H3Event(new Request("https://drop.example/signin/start?redirect=%2Fdrops"))
    event.context.log = createRequestLogger()
    const response = await signInStart(event)
    assert.equal(response.status, 302)
    assert.equal(response.headers.get("location"), "/signin?redirect=%2Fdrops")
    assert.deepEqual(event.context.log.getContext().auth, { signIn: "start failed", status })
  })
}
