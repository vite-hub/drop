import assert from "node:assert/strict"
import { createCommentSend } from "vite-hub/comments/client"
import { test } from "vite-plus/test"
import { createStubSend } from "../../app/utils/comment-send.ts"

let at = 1
const thread = (n, authorId, fields = {}) => ({
  id: `c${n}`,
  n,
  authorId,
  agent: null,
  mine: authorId === "ada",
  resolved: false,
  createdAt: at++,
  replies: [],
  ...fields,
})
const reply = (authorId, fields = {}) => ({ authorId, agent: null, createdAt: at++, ...fields })

test("Send N counts every open thread that waits for an answer, others' too, until a send carries it", async () => {
  const send = createStubSend()
  let comments = [
    thread(1, "ada"),
    thread(2, "bob"),
    thread(3, "carol", { replies: [reply("ada")] }),
    thread(4, "bob", { replies: [reply("ada", { agent: { name: "Claude", image: null } })] }),
    thread(5, "bob", { resolved: true }),
  ]
  const transport = send.transport({ drop: "abc", me: "ada", comments: () => comments })
  assert.equal((await transport.status()).count, 3)
  assert.equal((await send.transport({ drop: "abc", me: "bob", comments: () => comments }).status()).count, 3)

  const { code } = await transport.startPairing()
  send.controls.pair({ name: "T3 Code", logo: "t3", host: "relay.t3.codes" })
  assert.equal((await transport.allow(code)).status, "sent")
  assert.equal((await transport.status()).count, 0)

  // A new word in a carried thread, or a new thread from anyone, waits again.
  comments = comments.map((item) => (item.n === 2 ? { ...item, replies: [reply("bob")] } : item))
  comments.push(thread(6, "dave"))
  assert.equal((await transport.status()).count, 2)
  assert.equal((await transport.send()).status, "sent")
  assert.equal((await transport.status()).count, 0)
})

test("pairing confirms the current count and carries only that batch even if delivery takes time", async () => {
  const send = createStubSend()
  const comments = [thread(1, "ada"), thread(2, "bob"), thread(3, "ada")]
  const transport = send.transport({ drop: "abc", me: "ada", comments: () => comments })
  const client = createCommentSend(transport, { pairingInterval: 1 })
  const stop = client.start()
  try {
    await client.refresh()
    await client.send()
    assert.equal(client.state.status, "pairing")
    comments.push(thread(4, "bob"))
    await client.refresh()

    const { promise, resolve } = Promise.withResolvers()
    const unwatch = client.onChange(() => {
      if (client.state.status === "confirm") resolve()
    })
    send.controls.pair({ name: "T3 Code", logo: "t3", host: "relay.t3.codes" })
    await promise
    unwatch()
    assert.equal(client.state.count, 4)

    comments.push(thread(5, "bob"))
    await client.refresh()
    assert.equal(client.state.count, 5)
    send.controls.hold()
    const delivery = client.allow()
    comments[0].replies.push(reply("ada"))
    comments.push(thread(6, "bob"))
    await client.refresh()
    send.controls.release()
    await delivery
    assert.equal(client.state.status, "sent")
    assert.equal((await transport.status()).count, 2)
    assert.equal(
      (await send.transport({ drop: "abc", me: "ada", comments: () => comments.slice(1, 5) }).status()).count,
      0,
    )
  } finally {
    stop()
  }
})
