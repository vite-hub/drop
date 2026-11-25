import assert from "node:assert/strict"
import { createAuthHandler, listAuthEvents } from "@vite-hub/auth/server"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { afterEach, beforeEach, test, vi } from "vite-plus/test"
import { createDatabaseAuthEventStore, defineAuth } from "vite-hub/auth"
import { migrate, reset, sql, state } from "../cost/harness.mjs"

const { default: schema } = await import("../../server/databases/default/index.ts")
const { proxyAuth } = await import("../../server/utils/proxy-auth.ts")

migrate()
beforeEach(() => {
  reset()
  state.authProxy = true
  state.members = "github-org:example"
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.pathname.startsWith("/user/memberships/")) return Response.json({ state: "active" })
      if (url.pathname === "/user") return Response.json({ id: 42, login: "ada", email: "ada@example.com" })
      if (url.pathname === "/user/emails")
        return Response.json([{ email: "ada@example.com", primary: true, verified: true }])
      throw new Error(`Unexpected GitHub request: ${url}`)
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  state.authProxy = false
  state.members = ""
})

// Drop's Auth as server/auth.ts wires its event log: ViteHub's database store on Drop's database, and the proxy sign-in.
const definition = defineAuth(() => ({
  baseURL: "https://drop.example",
  secret: "test-only-secret-at-least-thirty-two-characters",
  database: drizzleAdapter(state.db, { provider: "sqlite", schema: schema.schema }),
  events: { store: createDatabaseAuthEventStore({ db: state.db }) },
  plugins: [proxyAuth()],
}))
const handle = createAuthHandler(definition)
const getSession = (headers) => handle(new Request("https://drop.example/api/auth/get-session", { headers }))

async function logged() {
  const [error, page] = await listAuthEvents({}, definition)
  assert.equal(error, undefined)
  return page.events
    .map(({ type, actor, userId, metadata }) => ({ type, actor, userId, method: metadata.method }))
    .sort((left, right) => left.type.localeCompare(right.type))
}

test("the event log records a proxy sign-in as method forward, and an expired session as expired, with no Drop code", async () => {
  const signedIn = await getSession({ "x-auth-request-access-token": "test-forward" })
  assert.equal(signedIn.status, 200)
  const { user } = await signedIn.json()
  assert.equal(user.email, "ada@example.com")
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ")

  sql.exec(`UPDATE session SET expires_at = ${Date.now() - 60_000}`)
  const expired = await getSession({ cookie })
  assert.equal(await expired.json(), null)

  assert.deepEqual(await logged(), [
    { type: "session.expired", actor: "system", userId: user.id, method: undefined },
    { type: "user.signed_in", actor: `user:${user.id}`, userId: user.id, method: "forward" },
    { type: "user.signed_up", actor: `user:${user.id}`, userId: user.id, method: "forward" },
  ])
})
