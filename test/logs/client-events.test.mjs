import assert from "node:assert/strict"
import { H3Event } from "h3"
import { beforeEach, test, vi } from "vite-plus/test"
import { state } from "../cost/harness.mjs"

const logged = []
vi.mock("evlog/nitro/v3", () => ({
  useLogger: () => ({ info: (message, fields) => logged.push({ level: "info", message, ...fields }) }),
}))
const { default: clientEvents } = await import("../../server/api/client-events.post.ts")

function post(body) {
  return clientEvents(
    new H3Event(
      new Request("https://drop.example/api/client-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  )
}

beforeEach(() => {
  state.bursts.length = 0
  state.failBurst = false
  logged.length = 0
})

const valid = [
  { event: "card.shown", reason: "signed-out" },
  { event: "card.shown", reason: "no-access" },
  { event: "signin.clicked", mode: "proxy", via: "button" },
  { event: "signin.clicked", mode: "github", via: "button" },
  { event: "signin.clicked", mode: "proxy", via: "card" },
  { event: "signin.switch_account" },
  { event: "signin.failed", code: "GITHUB_REAUTH_REQUIRED", status: 401 },
  { event: "signin.failed" },
  { event: "consent.allowed" },
  { event: "consent.denied" },
  { event: "consent.failed", code: "invalid_request", status: 403 },
  { event: "consent.invalid_link" },
]

for (const body of valid)
  test(`${body.event} ${JSON.stringify(body)} is logged at info`, async () => {
    const response = await post(body)
    assert.equal(response.status, 204)
    assert.deepEqual(logged, [
      { level: "info", message: `Client: ${body.event}`, action: "client-event", client: body },
    ])
  })

for (const [label, body] of [
  ["an unknown event", { event: "signin.hacked" }],
  ["the server's own signin.redirected", { event: "signin.redirected" }],
  ["the server's own signin.returned, which only a new session logs", { event: "signin.returned" }],
  ["a click the server counts itself", { event: "signin.clicked", mode: "github", via: "auto" }],
  ["a click without where it came from", { event: "signin.clicked", mode: "github" }],
  ["an unknown reason", { event: "card.shown", reason: "because" }],
  ["a field the event doesn't take", { event: "signin.clicked", mode: "proxy", via: "card", reason: "signed-out" }],
  ["free text", { event: "consent.allowed", message: "Signed in as someone@example.com" }],
  ["free text as a code", { event: "signin.failed", code: "Couldn't sign in, try again" }],
  ["a status out of range", { event: "consent.failed", status: 1000 }],
  ["no event", { reason: "signed-out" }],
])
  test(`${label} is a 400 and logs nothing`, async () => {
    await assert.rejects(post(body), (error) => error.status === 400)
    assert.deepEqual(logged, [])
  })

test("client events are rate-limited", async () => {
  await post({ event: "consent.allowed" })
  assert.deepEqual(state.bursts, [{ bucket: "client-event", limit: 30, window: "1m" }])
  state.failBurst = true
  await assert.rejects(post({ event: "consent.allowed" }), (error) => error.status === 429)
  assert.equal(logged.length, 1)
})
