import assert from "node:assert/strict"
import { H3Event, HTTPError } from "h3"
import { afterEach, beforeEach, test, vi } from "vite-plus/test"
import { state } from "../cost/harness.mjs"

vi.mock("nitro", () => ({ definePlugin: (plugin) => plugin }))

const { default: cardShown } = await import("../../server/plugins/card-shown.ts")
const { default: contentError } = await import("../../server/handlers/content-error.ts")
const { background } = await import("../../server/utils/logs.ts")
const { countCardShown } = await import("../../app/utils/client-events.ts")
let onResponse
await cardShown({ hooks: { hook: (_name, fn) => (onResponse = fn) } })

let info
beforeEach(() => {
  info = vi.spyOn(background, "info").mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  state.authProxy = false
})

const cards = () =>
  info.mock.calls
    .map(([fields]) => fields)
    .filter((fields) => fields.action === "client-event")
    .map(({ client, path, status }) => ({ client, path, status }))

test("a direct request for an unavailable /drops/:id counts its server-rendered card once, and hydration sends nothing", () => {
  const sent = []
  const page = new H3Event(new Request("https://drop.example/drops/deleted-drop"))
  countCardShown("no-access", { context: page.context }, (body) => sent.push(body))
  countCardShown("no-access", { context: page.context }, (body) => sent.push(body))
  onResponse(new Response("<html>", { status: 200 }), page)
  countCardShown("no-access", { hydrating: true }, (body) => sent.push(body))
  assert.deepEqual(cards(), [
    { client: { event: "card.shown", reason: "no-access" }, path: "/drops/deleted-drop", status: 200 },
  ])
  assert.deepEqual(sent, [], "First load adds no browser request")
})

test("a client navigation to the card counts it from the browser, and no server render counts it again", () => {
  const sent = []
  countCardShown("no-access", { hydrating: false }, (body) => sent.push(body))
  assert.deepEqual(sent, [{ event: "card.shown", reason: "no-access" }])
  onResponse(Response.json({}), new H3Event(new Request("https://drop.example/api/drops/deleted-drop")))
  assert.deepEqual(cards(), [])
})

test("a page without the card counts nothing, and the standalone error page counts only its own card", async () => {
  onResponse(new Response("<html>", { status: 200 }), new H3Event(new Request("https://drop.example/drops")))
  assert.deepEqual(cards(), [])
  const event = new H3Event(new Request("https://drop.example/d/11111111-1111-4111-8111-111111111111"))
  event.context.dropIdentity = Promise.resolve(null)
  const response = await contentError(new HTTPError({ status: 404 }), event)
  onResponse(response, event)
  assert.deepEqual(
    cards().map(({ client }) => client),
    [{ event: "card.shown", reason: "signed-out" }],
  )
})
