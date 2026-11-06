import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { betterAuth } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { jwt } from "better-auth/plugins"
import { oauthProvider } from "@better-auth/oauth-provider"
import { H3Event } from "h3"
import { test, vi } from "vite-plus/test"
import { CLIENT_IP_HEADERS } from "../../shared/client-ip.ts"

const config = vi.hoisted(() => ({ clientIpHeader: "" }))
vi.mock("nitro/runtime-config", () => ({ useRuntimeConfig: () => config }))
const { default: clientIp } = await import("../../server/middleware/0.0.client-ip.ts")

for (const [host, header] of Object.entries(CLIENT_IP_HEADERS)) {
  test(`${host}: rotating caller IP headers cannot reset the registration limit`, async () => {
    config.clientIpHeader = header
    const database = new DatabaseSync(":memory:")
    const options = {
      database,
      baseURL: "https://drop.example",
      secret: "test-secret-for-client-ip-rate-limit-123456",
      rateLimit: { enabled: true, storage: "database" },
      advanced: { ipAddress: { ipAddressHeaders: [header] } },
      plugins: [
        jwt(),
        oauthProvider({
          loginPage: "/oauth",
          allowDynamicClientRegistration: true,
          allowUnauthenticatedClientRegistration: true,
          clientRegistrationDefaultApplicationType: "infer",
        }),
      ],
    }
    try {
      await (await getMigrations(options)).runMigrations()
      const register = async (attempt, address) => {
        const request = new Request("https://drop.example/api/auth/oauth2/register", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": `198.51.100.${attempt}`,
            "x-drop-client-ip": `198.51.100.${attempt}`,
            // Simulate the ingress overwriting its header, or srvx supplying Deno's connection address.
            ...(host === "deno" ? {} : { [header]: address }),
          },
          body: JSON.stringify({
            client_name: "Rate limit test",
            redirect_uris: ["http://127.0.0.1:8080/callback"],
            token_endpoint_auth_method: "none",
          }),
        })
        if (host === "deno") Object.defineProperty(request, "ip", { value: address })
        const event = new H3Event(request)
        clientIp(event)
        // Drop creates Auth per request. The database must keep the limit across those instances.
        return betterAuth(options).handler(event.req)
      }
      for (let attempt = 1; attempt <= 5; attempt++) assert.equal((await register(attempt, "203.0.113.10")).status, 201)
      const limited = await register(6, "203.0.113.10")
      assert.equal(limited.status, 429)
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM oauthClient").get().count, 5)
      assert.equal((await register(7, "203.0.113.11")).status, 201)
    } finally {
      database.close()
    }
  })
}

test("Deno removes a forged internal IP header even when no connection address is available", () => {
  config.clientIpHeader = CLIENT_IP_HEADERS.deno
  const event = new H3Event(
    new Request("https://drop.example/api/auth/oauth2/register", {
      headers: { "x-drop-client-ip": "198.51.100.1", "x-forwarded-for": "198.51.100.2" },
    }),
  )
  clientIp(event)
  assert.equal(event.req.headers.get(CLIENT_IP_HEADERS.deno), null)
})

test("Deno accepts immutable incoming headers and preserves the request body and runtime", async () => {
  config.clientIpHeader = CLIENT_IP_HEADERS.deno
  const request = new Request("https://drop.example/api/auth/oauth2/register", { method: "POST", body: "metadata" })
  // Deno.serve's incoming Request uses the same immutable Headers guard as a redirect response.
  const headers = Response.redirect("https://drop.example").headers
  assert.throws(() => headers.set("x-drop-client-ip", "198.51.100.1"), TypeError)
  const runtime = { name: "deno" }
  Object.defineProperties(request, {
    headers: { value: headers, configurable: true },
    ip: { value: "203.0.113.10" },
    runtime: { value: runtime },
  })
  const event = new H3Event(request)
  clientIp(event)
  assert.equal(event.req.headers.get(CLIENT_IP_HEADERS.deno), "203.0.113.10")
  assert.equal(event.req.runtime, runtime)
  assert.equal(await event.req.text(), "metadata")
})
