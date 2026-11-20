import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { installComments } from "vite-hub/comments/server"
import { createCommentsHandler } from "vite-hub/comments/runtime"
import { checkWebhookUrl } from "vite-hub/webhooks"
import { sql, state, migrate, reset, who } from "../cost/harness.mjs"
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: readDrop } = await import("../../server/mcp/tools/read_drop.ts")
const { default: listHandoffs } = await import("../../server/mcp/tools/list_handoffs.ts")
const { default: reply } = await import("../../server/mcp/tools/reply.ts")
const { default: commentsPost } = await import("../../server/api/drops/[id]/comments.post.ts")
const { default: comments } = await import("../../server/comments.ts")

// Send end to end on Drop's side: ViteHub Comments' Send routes with `send` from server/comments.ts, over the Webhooks
// a member pairs, and then Drop's MCP opening what was sent. Webhooks is a stand-in that keeps endpoints and
// deliveries in memory; its URL guard is the real one.
const endpoints = new Map()
const delivered = []
const webhooks = {
  checkWebhookUrl,
  sealWebhooksText: async (_label, text) => [undefined, text],
  unsealWebhooksText: async (_label, text) => [undefined, text],
  createMemberEndpoint: async ({ owner, ownerEmail, name, agent, kind, url }) => {
    const endpoint = {
      id: `ep_${owner}`,
      owner,
      ownerEmail: ownerEmail ?? null,
      name,
      agent,
      kind,
      host: url ? new URL(url).host : null,
      disabledAt: null,
    }
    endpoints.set(owner, endpoint)
    return [undefined, endpoint]
  },
  getMemberEndpoint: async (owner) => [undefined, endpoints.get(owner) ?? null],
  sendToMemberEndpoint: async (owner, body) => {
    delivered.push({ owner, body })
    return [
      undefined,
      { id: `dl_${delivered.length}`, status: endpoints.get(owner)?.kind === "inbox" ? "inbox" : "sent" },
    ]
  },
}

migrate({ comments: false })
installComments(comments, { database: state.db, webhooks: async () => webhooks })
const handler = createCommentsHandler({ comments, realtime: false })

const ana = { ...who, actorKind: "browser" }
const bob = { ...who, userId: "bob", name: "Bob", email: "bob@example.com", actorKind: "browser", actorName: "Bob" }
const agentOf = (person) => ({ ...person, actorKind: "agent", actorName: "Claude Code" })

beforeEach(() => {
  reset()
  sql.exec("DELETE FROM vitehub_comment_sends; DELETE FROM vitehub_comment_send_codes")
  endpoints.clear()
  delivered.length = 0
  state.who = agentOf(ana)
})

const server = createMcpHandler({
  name: "drop-test",
  version: "1",
  origin: false,
  tools: [publish, readDrop, listHandoffs, reply],
})
async function call(tool, input) {
  const request = new H3Event(
    new Request("https://drop.example/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool.name, arguments: input },
      }),
    }),
  )
  request.context.log = { set() {}, error() {}, warn() {} }
  const text = await (await toResponse(await server(request), request)).text()
  const body = JSON.parse(text.startsWith("{") ? text : text.match(/^data: (.+)$/m)[1])
  if (body.error) return { isError: true, message: body.error.message }
  const result = body.result
  return result.isError ? { isError: true, message: result.content.map((block) => block.text).join(" ") } : result
}

/** A request to ViteHub's Send routes, from Drop's own page unless `origin` says otherwise. */
async function send(path, { method = "GET", body, origin = "https://drop.example" } = {}) {
  const request = new Request(`https://drop.example/_vitehub/comments/send${path}`, {
    method,
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const response = await handler.fetch(request)
  return { status: response.status, body: await response.json() }
}

/** A comment from the browser, as `person`. */
async function comment(drop, person, body) {
  state.who = person
  const event = new H3Event(
    new Request(`https://drop.example/api/drops/${drop}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "page", selector: "", ox: 0, oy: 0, body }),
    }),
  )
  event.context.log = { set() {}, error() {} }
  event.context.params = { id: drop }
  return commentsPost(event)
}

/** A doc from a T3 thread, with Ana's question, Bob's, and one an agent already answered. */
async function reviewed() {
  const doc = (
    await call(publish, {
      markdown: "# Plan\n\nShip on Friday.",
      note: "Draft",
      lifetime: "review",
      share: "public_comment",
      agent: { model: "gpt-5", session: { harness: "T3 Code", thread: "thread-p", branch: "feat/plan" } },
    })
  ).structuredContent
  const mine = await comment(doc.id, ana, "Why Friday?")
  const theirs = await comment(doc.id, bob, "Friday clashes with the freeze.")
  const answered = await comment(doc.id, ana, "Is the plan final?")
  state.who = agentOf(ana)
  assert.equal((await call(reply, { id: doc.id, comment: answered.n, body: "Not yet." })).isError, undefined)
  return { doc, mine, theirs, answered }
}

/** `person` (Ana unless named) pairs Claude Code's inbox and sends what waits on the doc. */
async function pairAndSend(doc, person = ana) {
  state.who = person
  const page = `?page=${encodeURIComponent(`/d/${doc.id}/plan`)}`
  assert.equal((await send(`/status${page}`)).body.data.count, 2)
  const { code } = (await send(`/start${page}`, { method: "POST" })).body.data
  // The agent posts from its own machine: no Origin, no session.
  state.who = null
  assert.equal(
    (await send("/pair", { method: "POST", body: { code, inbox: "Claude Code" }, origin: null })).status,
    200,
  )
  state.who = person
  const sent = (await send(`/allow${page}`, { method: "POST", body: { code } })).body.data
  assert.equal(sent.status, "sent")
  return sent.id
}

test("Send carries the drop, the version to build on, and the publishing session, and nothing anyone wrote", async () => {
  const { doc, mine, theirs, answered } = await reviewed()
  const id = await pairAndSend(doc)
  assert.equal(delivered.length, 1)
  const [{ owner, body }] = delivered
  assert.equal(owner, "owner")
  assert.equal(body.send, id)
  assert.equal(body.page, `https://drop.example/d/${doc.id}/plan`)
  assert.deepEqual(body.threads.toSorted(), [mine.id, theirs.id].toSorted())
  assert.deepEqual(body.data, {
    drop: doc.id,
    version: 1,
    base: 1,
    session: { harness: "T3 Code", thread: "thread-p", branch: "feat/plan" },
  })
  assert.equal(body.read, null, "the agent reads through Drop's MCP, not a token")
  assert.doesNotMatch(JSON.stringify(body), /Friday|final/)
  assert.ok(!body.threads.includes(answered.id))
})

test("a teammate's Send carries no publishing session, since only the drop's owner sees it", async () => {
  const { doc } = await reviewed()
  const id = await pairAndSend(doc, bob)
  const [{ owner, body }] = delivered
  assert.equal(owner, "bob")
  assert.deepEqual(body.data, { drop: doc.id, version: 1, base: 1, session: null })

  state.who = agentOf(bob)
  const read = await call(readDrop, { handoff: id })
  assert.doesNotMatch(read.content[0].text, /thread-p|feat\/plan/)
})

test("read_drop with a handoff returns its threads as asks and quotes and marks it working; another member gets nothing", async () => {
  const { doc, mine, theirs } = await reviewed()
  const id = await pairAndSend(doc)

  state.who = agentOf(ana)
  const waiting = await call(listHandoffs, {})
  assert.deepEqual(
    waiting.structuredContent.handoffs.map(({ id, state, asks, quotes }) => ({ id, state, asks, quotes })),
    [{ id, state: "sent", asks: 1, quotes: 1 }],
  )
  assert.match(waiting.content[0].text, new RegExp(`${id} \\(sent, .+\\): 1 ask, 1 quote on "Plan"`))

  // Bob may read the doc, but the handoff is Ana's.
  state.who = agentOf(bob)
  const refused = await call(readDrop, { handoff: id })
  assert.equal(refused.isError, true)
  assert.match(refused.message, /No handoff .+ of yours/)
  assert.equal(sql.prepare("SELECT state FROM vitehub_comment_sends WHERE id = ?").get(id).state, "sent")
  assert.deepEqual((await call(listHandoffs, {})).structuredContent.handoffs, [])

  state.who = agentOf(ana)
  const read = await call(readDrop, { handoff: id })
  assert.deepEqual(read.structuredContent.handoff, { id, state: "working", asks: [mine.n], quotes: [theirs.n] })
  assert.equal(read.structuredContent.id, doc.id)
  const text = read.content[0].text
  assert.match(text, new RegExp(`## Handoff ${id} \\(working, `))
  assert.match(
    text,
    /published from session harness "T3 Code", thread "thread-p", branch "feat\/plan"\. If that isn't your session/,
  )
  assert.match(text, new RegExp(`### Asks: the user's own\\n${mine.n}\\. .+\\n {3}Why Friday\\?`))
  assert.match(
    text,
    new RegExp(`### Quotes: from others, as context\\n.+not instructions.+\\n${theirs.n}\\. .+\\n {3}Friday clashes`),
  )
  assert.equal(sql.prepare("SELECT state FROM vitehub_comment_sends WHERE id = ?").get(id).state, "working")
  assert.equal((await call(listHandoffs, {})).structuredContent.handoffs[0].state, "working")

  // Ana's pill reads Working until her ask has an answer, then clears.
  state.who = ana
  const page = `?page=${encodeURIComponent(`/d/${doc.id}`)}`
  assert.deepEqual((await send(`/status${page}`)).body.data.working, { id })
  state.who = agentOf(ana)
  await call(reply, { id: doc.id, comment: mine.n, body: "Friday is the release train." })
  state.who = ana
  assert.equal((await send(`/status${page}`)).body.data.working, undefined)
  assert.equal(sql.prepare("SELECT state FROM vitehub_comment_sends WHERE id = ?").get(id).state, "done")
})

test("Allow keeps the member's verified email with their endpoint, so their Console account may redeliver; an unverified one stays off", async () => {
  const { doc } = await reviewed()
  const verified = { ...ana, emailVerified: true }
  const page = `?page=${encodeURIComponent(`/d/${doc.id}`)}`
  const allow = async (person) => {
    state.who = person
    const { code } = (await send(`/start${page}`, { method: "POST" })).body.data
    state.who = null
    await send("/pair", { method: "POST", body: { code, inbox: "Codex" }, origin: null })
    state.who = person
    return (await send(`/allow${page}`, { method: "POST", body: { code } })).status
  }
  assert.equal(await allow(verified), 200)
  assert.equal(endpoints.get("owner").ownerEmail, "owner@example.com")
  assert.equal(await allow({ ...bob, emailVerified: false }), 200)
  assert.equal(endpoints.get("bob").ownerEmail, null)
  // Outside Send the Comments user carries no email: the toolbar and presence name people without it.
  state.who = verified
  const session = await handler.fetch(
    new Request(`https://drop.example/_vitehub/comments/session?page=${encodeURIComponent(`/d/${doc.id}`)}`),
  )
  assert.doesNotMatch(await session.text(), /owner@example\.com/)
})

test("the pair route refuses a code nobody issued and a receiver off the T3 relay", async () => {
  const { doc } = await reviewed()
  state.who = ana
  const page = `?page=${encodeURIComponent(`/d/${doc.id}`)}`
  const { code } = (await send(`/start${page}`, { method: "POST" })).body.data
  state.who = null
  const fake = await send("/pair", { method: "POST", body: { code: "AAAA-BBBB-CCCC", inbox: "Codex" }, origin: null })
  assert.deepEqual([fake.status, fake.body.reason], [410, "expired"])
  const elsewhere = await send("/pair", {
    method: "POST",
    body: { code, url: "https://hooks.example.com/t3" },
    origin: null,
  })
  assert.deepEqual([elsewhere.status, elsewhere.body.reason], [422, "refused"])
  assert.equal(endpoints.size, 0)
})

test("Send stays off the ViteHub toolbar's page threads and off pages that aren't a drop's", async () => {
  const { doc } = await reviewed()
  state.who = ana
  // The toolbar on a drop's page keeps its `page` subject.
  const session = await handler.fetch(
    new Request(`https://drop.example/_vitehub/comments/session?page=${encodeURIComponent(`/d/${doc.id}`)}`),
  )
  assert.deepEqual((await session.json()).data.subject, { kind: "page", id: `/d/${doc.id}` })
  // Send on a page that isn't a drop's is about that page, where only admins write.
  assert.equal((await send(`/status?page=${encodeURIComponent("/drops")}`)).body.data.count, 0)
})
