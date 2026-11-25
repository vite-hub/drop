import assert from "node:assert/strict"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { H3Event } from "h3"
import { afterEach, beforeEach, test, vi } from "vite-plus/test"
import { migrate, reset, state } from "../cost/harness.mjs"

const { default: schema } = await import("../../server/databases/default/index.ts")
const { proxyAuth } = await import("../../server/utils/proxy-auth.ts")
const { background } = await import("../../server/utils/logs.ts")
const { default: proxySession } = await import("../../server/middleware/0.15.proxy-session.ts")
const { logSignedIn } = await import("../../server/utils/sign-in-attempt.ts")
vi.mock("nitro/runtime-config", () => ({ useRuntimeConfig: () => ({}) }))
const { default: signInStart } = await import("../../server/routes/signin/start.get.ts")

migrate()
let info
beforeEach(() => {
  reset()
  info = vi.spyOn(background, "info").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  state.authProxy = false
  state.members = ""
  delete state.auth
})

const events = () => info.mock.calls.map(([fields]) => fields).filter((fields) => fields.action === "client-event")
const clients = () => events().map(({ client }) => client)

function startGitHub(query) {
  state.auth = {
    api: { signInSocial: async () => Response.json({ url: "https://github.com/login/oauth/authorize?state=x" }) },
  }
  const event = new H3Event(new Request(`https://drop.example/signin/start?redirect=%2Fd%2Fabc${query}`))
  return { event, response: signInStart(event) }
}

test("a recovery card's sign-in link counts the click and marks the attempt", async () => {
  const { event, response } = startGitHub("&choose=1&via=card")
  assert.equal((await response).headers.get("location"), "https://github.com/login/oauth/authorize?state=x")
  assert.deepEqual(clients(), [{ event: "signin.clicked", mode: "github", via: "card" }])
  assert.ok(
    event.res.headers.getSetCookie().includes("drop-signin-attempt=card; Path=/; Max-Age=600; SameSite=Lax; Secure"),
  )
})

test("an automatic redirect marks the attempt without counting a click, since the error page logged the redirect", async () => {
  const { event, response } = startGitHub("&via=auto")
  await response
  assert.deepEqual(clients(), [])
  assert.ok(event.res.headers.getSetCookie().some((cookie) => cookie.startsWith("drop-signin-attempt=auto;")))
})

test("a sign-in start without a known origin marks nothing", async () => {
  const { event, response } = startGitHub("&via=elsewhere")
  await response
  assert.deepEqual(clients(), [])
  assert.ok(!event.res.headers.getSetCookie().some((cookie) => cookie.startsWith("drop-signin-attempt=")))
})

test("a GitHub session counts the return wherever the callback lands, with the attempt's origin, and clears the mark", () => {
  const event = new H3Event(
    new Request("https://drop.example/api/auth/callback/github?code=x", {
      headers: { cookie: "drop-signin-attempt=button" },
    }),
  )
  logSignedIn(event, { path: "/callback/:id" })
  assert.deepEqual(clients(), [{ event: "signin.returned", mode: "github", via: "button" }])
  assert.ok(event.res.headers.getSetCookie().some((cookie) => /^drop-signin-attempt=; .*Max-Age=0/.test(cookie)))

  info.mockClear()
  logSignedIn(new H3Event(new Request("https://drop.example/api/auth/callback/github?code=y")), {
    path: "/callback/:id",
  })
  assert.deepEqual(clients(), [{ event: "signin.returned", mode: "github" }], "A session with no mark still counts")
})

test("a proxy session from a card link counts its return once, and an existing session counts nothing", async () => {
  state.authProxy = true
  state.members = "github-org:example"
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.pathname.startsWith("/user/memberships/")) return Response.json({ state: "active" })
      if (url.pathname === "/user") return Response.json({ id: 42, login: "maxi", email: "maxi@example.com" })
      if (url.pathname === "/user/emails")
        return Response.json([{ email: "maxi@example.com", primary: true, verified: true }])
      throw new Error(`Unexpected GitHub request: ${url}`)
    }),
  )
  let current
  state.auth = betterAuth({
    baseURL: "https://drop.example",
    secret: "test-only-secret-at-least-thirty-two-characters",
    database: drizzleAdapter(state.db, { provider: "sqlite", schema: schema.schema }),
    databaseHooks: { session: { create: { after: async (_, context) => logSignedIn(current, context) } } },
    plugins: [proxyAuth()],
  })
  const back = (cookie) =>
    new H3Event(
      new Request("https://drop.example/signin/start?redirect=%2Fd%2Fabc&via=card", {
        headers: { "x-auth-request-access-token": "test-card", ...(cookie ? { cookie } : {}) },
      }),
    )
  current = back()
  await proxySession(current)
  assert.deepEqual(clients(), [{ event: "signin.returned", mode: "proxy", via: "card" }])

  const cookie = current.context.dropSessionCookies.map((value) => value.split(";")[0]).join("; ")
  current = back(cookie)
  await proxySession(current)
  assert.equal(clients().length, 1, "Coming back already signed in establishes no session")
})
