import assert from "node:assert/strict"
import { test } from "vite-plus/test"

// Load the real Nuxt plugin with only Nuxt's registration helper supplied.
globalThis.defineNuxtPlugin = (plugin) => plugin
const { default: createPlugin } = await import("../../app/plugins/auth.ts")
delete globalThis.defineNuxtPlugin

test("each Nuxt app gets its own auth client and session state", () => {
  const first = createPlugin().provide.auth
  const second = createPlugin().provide.auth
  assert.notEqual(first, second)
  assert.notEqual(first.$store.atoms.session, second.$store.atoms.session)
  first.$store.atoms.session.set({ data: { user: { id: "first-account" } } })
  assert.equal(second.$store.atoms.session.get().data?.user, undefined)
})

async function browser(run) {
  const previousFetch = globalThis.fetch
  const previousWindow = globalThis.window
  const calls = []
  const origin = "https://drop.example"
  globalThis.window = { location: new URL("/oauth", origin) }
  globalThis.fetch = async (url, options) => {
    const path = new URL(url, origin).pathname
    calls.push({
      path,
      query: new URL(url, origin).searchParams,
      body: options.body ? JSON.parse(options.body) : undefined,
    })
    const data = path.endsWith("/public-client")
      ? { client_id: "mcp-client", client_name: "MCP agent" }
      : {
          redirect: true,
          url: path.endsWith("/consent")
            ? "com.cursor:/callback?code=answer"
            : "https://github.com/login/oauth/authorize",
        }
    return Response.json(data)
  }
  try {
    await run(createPlugin().provide.auth, calls)
  } finally {
    globalThis.fetch = previousFetch
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
}

test("OAuth sign-in and consent forward only signed parameters, including repeated resources", async () => {
  await browser(async (auth, calls) => {
    const query = new URLSearchParams({
      client_id: "mcp-client",
      scope: "openid offline_access",
      state: "oauth-state",
      ba_iat: "123",
      sig: "test-signature",
    })
    query.append("resource", "https://drop.example/mcp")
    query.append("resource", "https://other.example/mcp")
    for (const name of ["client_id", "scope", "state", "ba_iat", "resource", "ba_param"]) query.append("ba_param", name)
    const signed = query.toString()
    query.append("theme", "dark")
    query.append("redirect", "https://unrelated.example")
    const page = `https://drop.example/oauth?${query}`

    window.location = new URL(page)
    const signIn = await auth.signIn.social({ provider: "github", callbackURL: "/drops" })
    assert.equal(signIn.error, null)
    assert.equal(calls[0].path, "/api/auth/sign-in/social")
    assert.equal(calls[0].body.oauth_query, signed)
    assert.equal(window.location.href, "https://github.com/login/oauth/authorize")

    for (const accept of [true, false]) {
      window.location = new URL(page)
      const answer = await auth.oauth2.consent({ accept })
      assert.equal(answer.error, null)
      const call = calls.at(-1)
      assert.equal(call.path, "/api/auth/oauth2/consent")
      assert.equal(call.body.accept, accept)
      assert.equal(call.body.oauth_query, signed)
      assert.deepEqual(new URLSearchParams(call.body.oauth_query).getAll("resource"), [
        "https://drop.example/mcp",
        "https://other.example/mcp",
      ])
      assert.equal(window.location.href, "com.cursor:/callback?code=answer", "Better Auth handles native MCP redirects")
    }
  })
})

test("OAuth GET requests and ordinary GitHub sign-in do not receive an unsigned query", async () => {
  await browser(async (auth, calls) => {
    window.location = new URL("https://drop.example/oauth?client_id=mcp-client&sig=unsigned&redirect=%2Fdrops")
    const client = await auth.oauth2.publicClient({ query: { client_id: "mcp-client" } })
    assert.equal(client.data.client_name, "MCP agent")
    assert.equal(calls[0].query.get("client_id"), "mcp-client")
    assert.equal(calls[0].body, undefined)
    await auth.signIn.social({ provider: "github", callbackURL: "/drops" })
    assert.equal(calls[1].body.oauth_query, undefined)
  })
})
