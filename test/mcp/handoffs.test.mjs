import assert from "node:assert/strict"
import { beforeEach, test, vi } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { createMcpHandler } from "nitro-mcp-toolkit"
import { installComments } from "vite-hub/comments/server"
import { createCommentSend, createCommentSendTransport } from "vite-hub/comments/client"
import { createCommentsHandler } from "vite-hub/comments/runtime"
import * as realWebhooks from "vite-hub/webhooks"
import { createDrizzleWebhookEndpointStore, createDrizzleWebhookStore } from "vite-hub/webhooks/database"
import { installWebhooks } from "vite-hub/webhooks/runtime"
import { queries, sql, state, migrate, reset, who } from "../cost/harness.mjs"
const { default: publish } = await import("../../server/mcp/tools/publish.ts")
const { default: readDrop } = await import("../../server/mcp/tools/read_drop.ts")
const { default: listHandoffs } = await import("../../server/mcp/tools/list_handoffs.ts")
const { default: reply } = await import("../../server/mcp/tools/reply.ts")
const { default: commentsPost } = await import("../../server/api/drops/[id]/comments.post.ts")
const { default: commentPatch } = await import("../../server/api/comments/[id]/index.patch.ts")
const { default: comments } = await import("../../server/comments.ts")
const { default: disconnect } = await import("../../server/api/send/endpoint.delete.ts")
const { dropDetail, findDrop } = await import("../../server/utils/drops.ts")

// Send end to end on Drop's side: ViteHub Comments' Send routes with `send` from server/comments.ts, over real Webhooks
// pairing and endpoints, and then Drop's MCP opening what was sent. Only the delivery is a stand-in: it records what
// would go out.
const delivered = []
let rejectDelivery = false
const webhooks = {
  ...realWebhooks,
  sendToMemberEndpoint: async (owner, body, options) => {
    delivered.push({ owner, body, endpoint: options.endpointId })
    return [undefined, { id: `dl_${delivered.length}`, status: rejectDelivery ? "failed" : "inbox" }]
  },
}
/** The member's newest endpoint, as the table holds it. */
const endpointOf = (owner) =>
  sql.prepare("SELECT * FROM vitehub_webhook_endpoints WHERE owner = ? ORDER BY created_at DESC").get(owner)

migrate({ comments: false })
process.env.VITEHUB_WEBHOOKS_KEY ??= btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
installWebhooks({
  webhooks: {},
  store: createDrizzleWebhookStore(state.db),
  endpoints: createDrizzleWebhookEndpointStore(state.db),
})
installComments(comments, { database: state.db, webhooks: async () => webhooks })
const handler = createCommentsHandler({ comments, realtime: false })

const ana = { ...who, actorKind: "browser" }
const bob = { ...who, userId: "bob", name: "Bob", email: "bob@example.com", actorKind: "browser", actorName: "Bob" }
const agentOf = (person) => ({ ...person, actorKind: "agent", actorName: "Claude Code" })

beforeEach(() => {
  reset()
  sql.exec(
    "DELETE FROM vitehub_comment_sends; DELETE FROM vitehub_webhook_pairings; DELETE FROM vitehub_webhook_endpoints; DELETE FROM vitehub_webhook_deliveries",
  )
  delivered.length = 0
  rejectDelivery = false
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

const transportFor = (id) =>
  createCommentSendTransport({
    page: `/d/${id}`,
    fetch: (path, init) => handler.fetch(new Request(`https://drop.example${path}`, init)),
  })

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
  const { code, selection } = (await send(`/start${page}`, { method: "POST" })).body.data
  // The agent posts from its own machine: no Origin, no session.
  state.who = null
  assert.equal(
    (await send("/pair", { method: "POST", body: { code, inbox: "Claude Code" }, origin: null })).status,
    200,
  )
  state.who = person
  const sent = (await send(`/allow${page}`, { method: "POST", body: { code, selection } })).body.data
  assert.equal(sent.status, "sent")
  return sent.id
}

test("Send carries the drop, the version to build on, and the publishing session, and nothing anyone wrote", async () => {
  const { doc, mine, theirs, answered } = await reviewed()
  const id = await pairAndSend(doc)

  const page = `?page=${encodeURIComponent(`/d/${doc.id}`)}`
  state.who = ana
  const status = (await send(`/status${page}`)).body.data
  assert.deepEqual(status.sent, { id, inbox: true })
  assert.equal(status.working, undefined)
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

test("the owner's Send goes to the thread that published the drop; a teammate's carries no session and no address", async () => {
  // The owner paired the publishing thread first, then a newer inbox.
  const [, publishing] = await realWebhooks.createMemberEndpoint({
    owner: "owner",
    name: "T3 Code thread",
    address: "thread-p",
    kind: "inbox",
  })
  const owners = await reviewed()
  await pairAndSend(owners.doc)
  // Allow sends to the agent it just paired; the next Send goes to the publishing thread.
  assert.notEqual(delivered[0].endpoint, publishing.id)
  await comment(owners.doc.id, ana, "And the date?")
  state.who = ana
  const again = await send(`?page=${encodeURIComponent(`/d/${owners.doc.id}`)}`, { method: "POST", body: {} })
  assert.equal(again.body.data.status, "sent")
  assert.equal(delivered[1].endpoint, publishing.id)

  delivered.length = 0
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
  assert.equal((await send(`/status${page}`)).body.data.working.id, id)
  state.who = agentOf(ana)
  await call(reply, { id: doc.id, comment: mine.n, body: "Friday is the release train." })
  assert.deepEqual((await call(listHandoffs, {})).structuredContent.handoffs, [])
  state.who = ana
  assert.equal((await send(`/status${page}`)).body.data.working, undefined)
  assert.equal(sql.prepare("SELECT state FROM vitehub_comment_sends WHERE id = ?").get(id).state, "done")
})

test("reopening a handoff skips asks resolved or answered in another session", async () => {
  const { doc, mine } = await reviewed()
  const answered = await comment(doc.id, ana, "What is the rollout plan?")
  const waiting = await comment(doc.id, ana, "Who owns follow-up?")
  state.who = ana
  const transport = transportFor(doc.id)
  const { code, selection, count } = await transport.startPairing()
  assert.equal(count, 4)
  assert.equal((await send("/pair", { method: "POST", body: { code, inbox: "Codex" }, origin: null })).status, 200)
  const { id, status } = await transport.allow(code, selection)
  assert.equal(status, "sent")

  state.who = agentOf(ana)
  assert.equal((await call(readDrop, { handoff: id })).structuredContent.handoff.state, "working")
  assert.equal(
    (await call(reply, { id: doc.id, comment: mine.n, body: "Moved to Monday.", resolve: true })).isError,
    undefined,
  )
  assert.equal((await call(reply, { id: doc.id, comment: answered.n, body: "Staged rollout." })).isError, undefined)
  const resumed = await call(readDrop, { handoff: id, resolved: true })
  assert.deepEqual(resumed.structuredContent.handoff.asks, [waiting.n])
  assert.ok(resumed.structuredContent.comments.some((comment) => comment.n === mine.n && comment.resolved))
  const asks = resumed.content[0].text.split("### Asks:")[1].split("### Quotes:")[0]
  assert.match(asks, /Who owns follow-up\?/)
  assert.doesNotMatch(asks, /Why Friday|rollout plan/)

  assert.equal((await call(reply, { id: doc.id, comment: waiting.n, body: "I do." })).isError, undefined)
  const complete = await call(readDrop, { handoff: id })
  assert.deepEqual(complete.structuredContent.handoff.asks, [])
  assert.deepEqual(complete.structuredContent.handoff.quotes, [], "completed asks don't turn quotes into requests")
})

test("reopening an unanswered ask restores its completed handoff without sending again", async () => {
  const { doc, mine, theirs } = await reviewed()
  const id = await pairAndSend(doc)
  async function setResolved(thread, resolved) {
    state.who = ana
    const event = new H3Event(
      new Request(`https://drop.example/api/comments/${thread.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolved }),
      }),
    )
    event.context.log = { set() {}, error() {}, warn() {} }
    event.context.params = { id: thread.id }
    assert.deepEqual(await commentPatch(event), { ok: true })
  }

  await setResolved(mine, true)
  await setResolved(theirs, true)
  state.who = agentOf(ana)
  assert.deepEqual((await call(listHandoffs, {})).structuredContent.handoffs, [])
  assert.equal((await call(readDrop, { handoff: id })).structuredContent.handoff.state, "done")

  await setResolved(mine, false)
  state.who = agentOf(ana)
  assert.deepEqual(
    (await call(listHandoffs, {})).structuredContent.handoffs.map((handoff) => handoff.id),
    [id],
  )
  assert.deepEqual((await call(readDrop, { handoff: id })).structuredContent.handoff, {
    id,
    state: "working",
    asks: [mine.n],
    quotes: [],
  })
  assert.equal(delivered.length, 1)

  assert.equal(
    (await call(reply, { id: doc.id, comment: mine.n, body: "Moved to Monday.", resolve: true })).isError,
    undefined,
  )
  assert.deepEqual((await call(listHandoffs, {})).structuredContent.handoffs, [])
  await setResolved(mine, false)
  state.who = agentOf(ana)
  assert.deepEqual((await call(listHandoffs, {})).structuredContent.handoffs, [])
  assert.deepEqual((await call(readDrop, { handoff: id })).structuredContent.handoff.asks, [])
})

test("a quote-only handoff stays working until the quoted threads are answered", async () => {
  const { doc, mine, theirs } = await reviewed()
  assert.equal(
    (await call(reply, { id: doc.id, comment: mine.n, body: "Friday is the release train." })).isError,
    undefined,
  )

  const waiting = await comment(doc.id, bob, "Can we review it on Monday?")
  state.who = ana
  const transport = transportFor(doc.id)
  const { code, selection, count } = await transport.startPairing()
  assert.equal(count, 2)
  assert.equal((await send("/pair", { method: "POST", body: { code, inbox: "Codex" }, origin: null })).status, 200)
  const { id, status } = await transport.allow(code, selection)
  assert.equal(status, "sent")

  state.who = agentOf(ana)
  const read = await call(readDrop, { handoff: id })
  const handoff = read.structuredContent.handoff
  assert.deepEqual(
    { ...handoff, quotes: new Set(handoff.quotes) },
    {
      id,
      state: "working",
      asks: [],
      quotes: new Set([waiting.n, theirs.n]),
    },
  )
  assert.equal((await call(listHandoffs, {})).structuredContent.handoffs[0].id, id)
  state.who = ana
  assert.equal((await transport.status()).working.id, id)

  state.who = agentOf(ana)
  assert.equal(
    (await call(reply, { id: doc.id, comment: theirs.n, body: "Thanks; I'll check the freeze." })).isError,
    undefined,
  )
  const resumed = await call(readDrop, { handoff: id })
  assert.deepEqual(resumed.structuredContent.handoff.quotes, [waiting.n])
  assert.equal((await call(reply, { id: doc.id, comment: waiting.n, body: "Yes." })).isError, undefined)
  state.who = ana
  assert.equal((await transport.status()).working, undefined)
  state.who = agentOf(ana)
  assert.deepEqual((await call(listHandoffs, {})).structuredContent.handoffs, [])
})

test("pairing cannot send a changed selection and the copied prompt describes both inbox agents", async () => {
  const { doc, mine, theirs } = await reviewed()
  state.who = ana
  const transport = transportFor(doc.id)
  const { code, selection, count, prompt } = await transport.startPairing()
  assert.equal(count, 2)
  for (const inbox of ["Claude Code", "Codex"]) assert.ok(prompt.includes(JSON.stringify({ code, inbox })))
  await send("/pair", { method: "POST", body: { code, inbox: "Codex" }, origin: null })
  const added = await comment(doc.id, ana, "One more question.")
  assert.equal((await transport.allow(code, selection)).status, "failed")
  assert.equal(delivered.length, 0)
  assert.equal(endpointOf(ana.userId), undefined)
  const next = await transport.startPairing()
  assert.equal(next.count, 3)
  await send("/pair", { method: "POST", body: { code: next.code, inbox: "Codex" }, origin: null })
  assert.equal((await transport.allow(next.code, next.selection)).status, "sent")
  assert.deepEqual(delivered[0].body.threads.toSorted(), [mine.id, theirs.id, added.id].toSorted())
  assert.equal((await transport.status()).count, 0)
  state.who = bob
  assert.equal((await transport.status()).count, 3)
})

test("the real pill refreshes the batch both before and after pairing", async () => {
  const { doc, mine, theirs } = await reviewed()
  state.who = ana
  const transport = transportFor(doc.id)
  let code
  const client = createCommentSend(
    {
      ...transport,
      startPairing: async () => {
        const pairing = await transport.startPairing()
        code = pairing.code
        return pairing
      },
    },
    { pairingInterval: 5 },
  )
  try {
    await client.refresh()
    await client.send()
    const third = await comment(doc.id, ana, "Added during pairing.")
    await client.refresh()
    assert.equal(client.state.count, 3)

    const confirmed = new Promise((resolve) => {
      const off = client.onChange(() => {
        if (client.state.status !== "confirm") return
        off()
        resolve()
      })
    })
    await send("/pair", { method: "POST", body: { code, inbox: "Codex" }, origin: null })
    await confirmed
    const fourth = await comment(doc.id, ana, "Added during confirmation.")
    await client.refresh()
    assert.equal(client.state.count, 4)
    await client.allow()
    assert.equal(client.state.status, "sent")
    assert.deepEqual(delivered[0].body.threads.toSorted(), [mine.id, theirs.id, third.id, fourth.id].toSorted())
  } finally {
    client.start()()
  }
}, 3000)

test("retrying failed setup or Allow never sends to the publishing endpoint", async () => {
  const { doc } = await reviewed()
  const [, publishing] = await realWebhooks.createMemberEndpoint({
    owner: ana.userId,
    name: "Publishing thread",
    address: "thread-p",
    kind: "inbox",
    agent: "t3",
  })
  state.who = ana
  const transport = transportFor(doc.id)
  let pairCode
  const client = createCommentSend(
    {
      ...transport,
      startPairing: async () => {
        const pairing = await transport.startPairing()
        pairCode = pairing.code
        return pairing
      },
    },
    { pairingInterval: 5 },
  )
  try {
    await client.refresh()
    await client.pairAnother(() => Promise.reject(new Error("clipboard denied")))
    assert.equal(client.state.status, "failed")
    await client.send(() => Promise.resolve(true))
    assert.equal(client.state.status, "pairing")
    assert.equal(delivered.length, 0)

    const confirmed = new Promise((resolve) => {
      const off = client.onChange(() => {
        if (client.state.status !== "confirm") return
        off()
        resolve()
      })
    })
    await send("/pair", { method: "POST", body: { code: pairCode, inbox: "Codex" }, origin: null })
    await confirmed
    rejectDelivery = true
    await client.allow()
    assert.equal(client.state.status, "failed")
    assert.equal(delivered.length, 1)
    assert.notEqual(delivered[0].endpoint, publishing.id)
    await client.send()
    assert.equal(client.state.status, "idle")
    assert.equal(delivered.length, 1)
  } finally {
    client.start()()
  }
}, 3000)

test("a failed ordinary Send updates its count and clears when the comments are answered", async () => {
  const { doc, mine, theirs } = await reviewed()
  await realWebhooks.createMemberEndpoint({ owner: ana.userId, name: "Codex", kind: "inbox", agent: "codex" })
  state.who = ana
  const transport = transportFor(doc.id)
  const client = createCommentSend(transport)
  try {
    await client.refresh()
    rejectDelivery = true
    await client.send()
    assert.equal(client.state.status, "failed")
    assert.equal(client.state.count, 2)

    state.who = agentOf(ana)
    assert.equal(
      (await call(reply, { id: doc.id, comment: mine.n, body: "Friday is the release train." })).isError,
      undefined,
    )
    state.who = ana
    await client.refresh()
    assert.equal(client.state.status, "failed")
    assert.equal(client.state.count, 1)

    state.who = agentOf(bob)
    assert.equal(
      (await call(reply, { id: doc.id, comment: theirs.n, body: "The freeze has moved." })).isError,
      undefined,
    )
    state.who = ana
    assert.equal((await transport.status()).count, 0)
    await client.refresh()
    assert.deepEqual(client.state, { status: "idle", count: 0, inbox: true })
    assert.equal(delivered.length, 1)
  } finally {
    client.start()()
  }
})

test("an admin's revision does not forward the owner's handoff to the admin", async () => {
  const { doc } = await reviewed()
  state.who = agentOf({ ...bob, role: "admin" })
  const next = await call(publish, {
    previous: doc.id,
    base: 1,
    markdown: "# Revised plan",
    note: "Admin revision",
    agent: { session: { harness: "T3 Code", thread: "thread-admin" } },
  })
  assert.equal(next.structuredContent?.version, 2, next.message)
  const id = await pairAndSend(doc)
  assert.deepEqual(delivered[0].body.data, { drop: doc.id, version: 2, base: 2, session: null })
  state.who = agentOf(ana)
  assert.doesNotMatch((await call(readDrop, { handoff: id })).content[0].text, /hand this handoff's id/)
})

test("Send authorizes a busy drop once per request", async () => {
  const { doc } = await reviewed()
  for (let index = 0; index < 53; index++) await comment(doc.id, ana, `Question ${index}?`)
  state.who = ana
  queries.length = 0
  assert.equal((await transportFor(doc.id).status()).count, 55)
  assert.ok(queries.filter(({ query }) => query.includes('from "drops"')).length <= 4)
})

test("Disconnect all removes both approved T3 destinations, including the older publishing thread", async () => {
  const { doc } = await reviewed()
  const transport = transportFor(doc.id)
  const publishing = "t3-thread://v2/laptop/publishing"
  state.who = agentOf(ana)
  assert.equal(
    (
      await call(publish, {
        previous: doc.id,
        base: 1,
        markdown: "# New plan",
        note: "Second draft",
        agent: { session: { harness: "T3 Code", thread: publishing } },
      })
    ).structuredContent?.version,
    2,
  )
  state.who = ana
  const pairThread = async (thread) => {
    const { code, selection } = await transport.startPairing()
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" })
    try {
      assert.equal(
        (
          await send("/pair", {
            method: "POST",
            body: { code, thread, url: "https://relay.t3.codes/hook" },
            origin: null,
          })
        ).status,
        200,
      )
      assert.equal((await transport.allow(code, selection)).thread, thread)
    } finally {
      vi.unstubAllGlobals()
    }
  }
  await pairThread(publishing)
  await comment(doc.id, ana, "A question for another agent.")
  await pairThread("t3-thread://v2/laptop/newer")
  await comment(doc.id, ana, "A question for the publishing agent.")
  assert.equal((await transport.send()).thread, publishing)
  assert.equal(delivered[2].endpoint, delivered[0].endpoint)
  await disconnect(new H3Event(new Request("https://drop.example/api/send/endpoint", { method: "DELETE" })))
  await comment(doc.id, ana, "A question after disconnecting.")
  assert.equal((await transport.status()).agent, undefined)
  assert.equal((await transport.send()).status, "failed")
  assert.equal(delivered.length, 3)
})

test("a live-site screenshot keeps its own feedback and does not Send the parent site's threads", async () => {
  const { doc: site } = await reviewed()
  const { doc: shot } = await reviewed()
  sql.prepare("UPDATE drops SET kind = 'site' WHERE id = ?").run(site.id)
  sql.prepare("UPDATE drops SET kind = 'image', parent_id = ? WHERE id = ?").run(site.id, shot.id)
  await comment(shot.id, ana, "Only this screenshot.")
  const row = await findDrop(shot.id)
  assert.equal((await dropDetail(row, ana, "https://drop.example")).siteScreenshot, true)
  const page = `?page=${encodeURIComponent(`/d/${shot.id}`)}`
  state.who = { ...ana, role: "admin" }
  assert.deepEqual((await send(`/status${page}`)).body.data, { count: 0 })
  assert.equal((await send(page, { method: "POST" })).status, 403)
  assert.equal(delivered.length, 0)
})

test("Allow keeps the member's verified email with their endpoint, so their Console account may redeliver; an unverified one stays off", async () => {
  const { doc } = await reviewed()
  const verified = { ...ana, emailVerified: true }
  const page = `?page=${encodeURIComponent(`/d/${doc.id}`)}`
  const allow = async (person) => {
    state.who = person
    const { code, selection } = (await send(`/start${page}`, { method: "POST" })).body.data
    state.who = null
    await send("/pair", { method: "POST", body: { code, inbox: "Codex" }, origin: null })
    state.who = person
    return (await send(`/allow${page}`, { method: "POST", body: { code, selection } })).status
  }
  assert.equal(await allow(verified), 200)
  assert.equal(endpointOf("owner").owner_email, "owner@example.com")
  assert.equal(await allow({ ...bob, emailVerified: false }), 200)
  assert.equal(endpointOf("bob").owner_email, null)
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
  assert.equal(sql.prepare("SELECT count(*) AS n FROM vitehub_webhook_endpoints").get().n, 0)
})

test("Send stays off the ViteHub toolbar's page threads and off pages that aren't a drop's", async () => {
  const { doc } = await reviewed()
  state.who = ana
  // The toolbar on a drop's page keeps its `page` subject.
  const session = await handler.fetch(
    new Request(`https://drop.example/_vitehub/comments/session?page=${encodeURIComponent(`/d/${doc.id}`)}`),
  )
  assert.deepEqual((await session.json()).data.subject, { kind: "page", id: `/d/${doc.id}` })
  // Send doesn't use ordinary toolbar pages as subjects.
  assert.equal((await send(`/status?page=${encodeURIComponent("/drops")}`)).body.data.count, 0)
})
