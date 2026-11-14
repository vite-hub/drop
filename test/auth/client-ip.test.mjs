import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import { betterAuth } from "better-auth"
import { getMigrations } from "better-auth/db/migration"
import { jwt } from "better-auth/plugins"
import { oauthProvider } from "@better-auth/oauth-provider"
import { test } from "vite-plus/test"
import { defineAuth } from "vite-hub/auth"
import { createAuthHandler } from "vite-hub/auth/server"
import { CLIENT_IP_HEADERS } from "../../shared/client-ip.ts"

const authOptions = (database, header) => ({
  database,
  secret: "test-secret-for-client-ip-rate-limit-123456",
  rateLimit: { enabled: true, storage: "database" },
  ...(header ? { advanced: { ipAddress: { ipAddressHeaders: [header] } } } : {}),
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/oauth",
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: "infer",
    }),
  ],
})

/** Registers OAuth clients from one address while the caller rotates every IP header it can send. */
async function rotatingCallerCannotResetTheLimit(database, register) {
  for (let attempt = 1; attempt <= 5; attempt++) assert.equal((await register(attempt, "203.0.113.10")).status, 201)
  const limited = await register(6, "203.0.113.10")
  assert.equal(limited.status, 429)
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM oauthClient").get().count, 5)
  assert.equal((await register(7, "203.0.113.11")).status, 201)
}

const registration = (attempt, headers = {}) =>
  new Request("https://drop.example/api/auth/oauth2/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${attempt}`,
      "x-vitehub-client-address": `198.51.100.${attempt}`,
      ...headers,
    },
    body: JSON.stringify({
      client_name: "Rate limit test",
      redirect_uris: ["http://127.0.0.1:8080/callback"],
      token_endpoint_auth_method: "none",
    }),
  })

for (const [host, header] of Object.entries(CLIENT_IP_HEADERS)) {
  test(`${host}: rotating caller IP headers cannot reset the registration limit`, async () => {
    const database = new DatabaseSync(":memory:")
    const options = { ...authOptions(database, header), baseURL: "https://drop.example" }
    try {
      await (await getMigrations(options)).runMigrations()
      // Drop creates Auth per request. The database must keep the limit across those instances.
      await rotatingCallerCannotResetTheLimit(database, (attempt, address) =>
        // Simulate the ingress overwriting its header.
        betterAuth(options).handler(registration(attempt, { [header]: address })),
      )
    } finally {
      database.close()
    }
  })
}

for (const host of ["cloudflare", "deno"]) {
  test(`${host}: ViteHub Auth limits by the address the runtime reports, not a header the caller sends`, async () => {
    assert.equal(CLIENT_IP_HEADERS[host], undefined, "Drop names no header, so ViteHub's default applies")
    const database = new DatabaseSync(":memory:")
    const options = authOptions(database)
    try {
      await (await getMigrations({ ...options, baseURL: "https://drop.example" })).runMigrations()
      await rotatingCallerCannotResetTheLimit(database, (attempt, address) => {
        const request = registration(attempt, { "cf-connecting-ip": `198.51.100.${attempt}` })
        // Nitro's Cloudflare entry sets `ip` from cf-connecting-ip, and srvx from Deno's connection address.
        Object.defineProperty(request, "ip", { value: address })
        return createAuthHandler(defineAuth(() => ({ ...options, baseURL: "https://drop.example" })))(request)
      })
    } finally {
      database.close()
    }
  })
}
