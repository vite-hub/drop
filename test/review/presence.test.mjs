import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { insertDrop, migrate, reset, sql, state, who } from "../cost/harness.mjs"
const { presenceAllows, presenceIdentity, presenceOrigin, presenceRoom, presenceTicket } =
  await import("../../server/utils/presence.ts")
const { signReviewToken } = await import("../../server/utils/review.ts")
const { default: ticketPost } = await import("../../server/api/review/presence.post.ts")
const { default: ticketPreflight } = await import("../../server/api/review/presence.options.ts")
const { default: dropPresence } = await import("../../server/api/drops/[id]/presence.get.ts")
const { default: membersOnly } = await import("../../server/middleware/0.2.members-only.ts")

const SITE = "https://pr12-acme.preview.quiver.dk"
const DROP = "https://drop.example"

migrate()
beforeEach(() => {
  reset()
  state.authSecret = "test-secret"
  state.mode = "team"
  sql.prepare("INSERT INTO user (id, name, email) VALUES ('ada', 'Ada', 'ada@example.com')").run()
})

const ada = { ...who, userId: "ada", name: "Ada", email: "ada@example.com", actorName: "Ada" }
const site = (id = "site", overrides = {}) =>
  insertDrop(id, { kind: "site", blob_key: null, filename: "pr12-acme.preview.quiver.dk", site_url: SITE, ...overrides })

function event(url, { method = "GET", headers = {}, id } = {}) {
  const made = new H3Event(new Request(url.startsWith("http") ? url : DROP + url, { method, headers }))
  made.context.log = { set() {}, error() {}, warn() {} }
  if (id) made.context.params = { id }
  return made
}
async function answer(handler, made) {
  const value = await Promise.resolve()
    .then(() => handler(made))
    .catch((error) => error)
  return toResponse(value, made)
}

/** One connection to a presence room: identify, the origin check, and authorize, each on its own request as ViteHub runs them. */
async function connect(room, query, origin = DROP) {
  const url = `${DROP}/api/_vitehub/realtime/presence/${room}?${new URLSearchParams(query)}`
  const fresh = () => event(url, { headers: { origin, upgrade: "websocket" } })
  const first = fresh()
  return {
    identity: await presenceIdentity(first, first.req),
    origin: await presenceOrigin(fresh(), fresh().req, origin),
    read: await presenceAllows(first, first.req, room, "read"),
    write: await presenceAllows(fresh(), fresh().req, room, "write"),
  }
}

test("a presence room's name is the drop's, keyed, so it never names the drop", async () => {
  const one = await presenceRoom(event("/"), { id: "doc" })
  assert.equal(one, await presenceRoom(event("/"), { id: "doc" }))
  assert.notEqual(one, await presenceRoom(event("/"), { id: "other" }))
  assert.match(one, /^[0-9a-f]{32}$/)
  assert.doesNotMatch(one, /doc/)
  state.authSecret = "another-secret"
  assert.notEqual(one, await presenceRoom(event("/"), { id: "doc" }), "another Drop names its rooms otherwise")
})

test("Drop's viewer joins a drop's room only for people who could open it without its link", async () => {
  insertDrop("mine", { visibility: "private" })
  insertDrop("team", { visibility: "team" })
  insertDrop("public", { access: "view" })
  const room = async (id) => {
    const response = await answer(dropPresence, event(`/api/drops/${id}/presence`, { id }))
    return { status: response.status, body: response.status === 200 ? await response.json() : null }
  }

  state.who = who
  const own = await room("mine")
  assert.equal(own.status, 200)
  assert.equal(own.body.room, await presenceRoom(event("/"), { id: "mine" }))

  state.who = ada
  assert.equal((await room("mine")).status, 404, "a private drop stays its owner's")
  assert.equal((await room("team")).status, 200, "a team share reaches Ada")
  assert.equal((await room("public")).status, 404, "a public link doesn't count: Ada would only have its link")
  state.who = null
  assert.equal((await room("team")).status, 404, "nobody signed in joins")
  assert.equal((await room("public")).status, 404, "a stranger on a public link never learns who's reading")
  state.who = { ...ada, actorKind: "agent" }
  assert.equal((await room("team")).status, 404, "agents have no pointer to share")
})

test("a viewer's connection shows as the signed-in person and reads only its drop's room", async () => {
  insertDrop("team", { visibility: "team" })
  insertDrop("mine", { visibility: "private" })
  const team = await presenceRoom(event("/"), { id: "team" })

  state.who = ada
  const joined = await connect(team, { drop: "team" })
  assert.deepEqual(joined.identity, { id: "ada", name: "Ada" })
  assert.equal(joined.read, true)
  assert.equal(joined.write, false, "presence rooms are read-only")
  assert.equal(joined.origin, false, "a session never lets another origin in")
  // The room of another drop, or a drop Ada can't open, turns her away.
  assert.equal((await connect(await presenceRoom(event("/"), { id: "mine" }), { drop: "team" })).read, false)
  assert.equal((await connect(team, { drop: "mine" })).read, false)
  assert.equal((await connect(team, { drop: "mine" })).identity, null)
  assert.equal((await connect(team, {})).identity, null)

  // On a members-only Drop, a session whose membership ended joins nothing.
  state.members = "owner@example.com"
  assert.equal((await connect(team, { drop: "team" })).identity, null)
  state.members = undefined
})

test("review.js trades its token for a short ticket, only for people the review is shared with", async () => {
  site("site", { visibility: "team" })
  const now = Date.now()
  const { token: adaToken } = await signReviewToken(event("/"), { d: "site", u: "ada", n: "Ada", o: SITE })
  const ticket = async (bearer, origin = SITE) => {
    const response = await answer(
      ticketPost,
      event("/api/review/presence", { method: "POST", headers: { origin, authorization: `Bearer ${bearer}` } }),
    )
    return {
      status: response.status,
      cors: response.headers.get("access-control-allow-origin"),
      body: await response.json(),
    }
  }

  const issued = await ticket(adaToken)
  assert.equal(issued.status, 200)
  assert.equal(issued.cors, SITE)
  assert.equal(issued.body.room, await presenceRoom(event("/"), { id: "site" }))
  assert.ok(issued.body.expiresAt > now && issued.body.expiresAt <= now + 3_600_000 + 1000, "an hour at most")
  assert.doesNotMatch(JSON.stringify(issued.body), /"site"/, "nothing names the drop")

  // On a review anyone may comment on, guests and Ada comment, but only through its public link: no ticket.
  site("open", { access: "comment" })
  const { token: guestToken } = await signReviewToken(event("/"), { d: "open", u: null, n: "Bo (guest)", o: SITE })
  assert.equal((await ticket(guestToken)).status, 404)
  const { token: openToken } = await signReviewToken(event("/"), { d: "open", u: "ada", n: "Ada", o: SITE })
  assert.equal((await ticket(openToken)).status, 404)
  // A token for another origin is no session at all.
  assert.equal((await ticket(adaToken, "https://evil.example")).status, 401)

  // The preflight answers the origins a review covers.
  const preflight = await answer(
    ticketPreflight,
    event("/api/review/presence", { method: "OPTIONS", headers: { origin: SITE } }),
  )
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /POST/)
})

test("a ticket lets its reviewed page in, as its person, into its review's room only", async () => {
  site("site", { visibility: "team" })
  insertDrop("team", { visibility: "team" })
  const room = await presenceRoom(event("/"), { id: "site" })
  const claims = { d: "site", u: "ada", n: "Ada", o: SITE, e: Date.now() + 3_600_000 }
  const { ticket } = await presenceTicket(event("/"), claims)

  // Even with someone else signed in to Drop in the same browser, the ticket alone counts.
  state.who = who
  const joined = await connect(room, { ticket }, SITE)
  assert.equal(joined.origin, true)
  assert.deepEqual(joined.identity, { id: "ada", name: "Ada" })
  assert.equal(joined.read, true)
  assert.equal(joined.write, false)

  // Another page, another drop's room, or a bad ticket gets nothing, and the session is no fallback.
  const elsewhere = await connect(room, { ticket }, "https://evil.example")
  assert.equal(elsewhere.origin, false)
  assert.equal(elsewhere.identity, null)
  assert.equal((await connect(await presenceRoom(event("/"), { id: "team" }), { ticket }, SITE)).read, false)
  assert.equal((await connect(room, { ticket: "nope", drop: "site" }, SITE)).identity, null)
  assert.equal((await connect(room, { ticket: "nope", drop: "site" }, DROP)).identity, null)

  // An expired ticket, a site that stopped covering the page, or a share taken back ends it.
  const old = await presenceTicket(event("/"), { ...claims, e: Date.now() - 1 })
  assert.equal((await connect(room, { ticket: old.ticket }, SITE)).identity, null)
  sql.prepare("UPDATE drops SET share = 'private' WHERE id = 'site'").run()
  assert.equal((await connect(room, { ticket }, SITE)).identity, null)
  sql.prepare("UPDATE drops SET share = 'team', site_url = 'https://other.example' WHERE id = 'site'").run()
  assert.equal((await connect(room, { ticket }, SITE)).origin, false)
  // A guest's claims make no ticket at all.
  assert.equal(await presenceTicket(event("/"), { ...claims, u: null }), null)
})

test("a members-only Drop lets presence through its gate: the room and the ticket check everyone themselves", async () => {
  state.members = "ada@example.com"
  state.who = null
  assert.equal(await membersOnly(event("/api/review/presence")), undefined)
  assert.equal(await membersOnly(event("/api/_vitehub/realtime/presence/0123abcd")), undefined)
  await assert.rejects(Promise.resolve(membersOnly(event("/api/_vitehub/realtime/drops/x"))))
  await assert.rejects(Promise.resolve(membersOnly(event("/api/drops/x/presence"))))
  state.members = undefined
})
