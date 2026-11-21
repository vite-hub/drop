import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import { deliveryLine, waitingCount, waitingLabel, WAITING_NOTICE_MS } from "../../app/utils/comment-delivery.ts"

// What a comment that hasn't reached the server says under its words, one case per row of the plan's table: the
// outbox (ViteHub's, through Drop's transport) keeps each refusal's status, and the line follows it.
const pending = (error) => ({ status: "pending", requestId: "r1", files: [], ...(error ? { error } : {}) })
const failed = (status, why) => ({ status: "failed", requestId: "r1", files: [], error: { status, why } })
const written = 1_000

test("a comment on its way says nothing at first, then a muted 'Waiting to send'", () => {
  assert.equal(deliveryLine(pending(), written, written + WAITING_NOTICE_MS - 1), undefined)
  assert.deepEqual(deliveryLine(pending(), written, written + WAITING_NOTICE_MS), {
    state: "waiting",
    text: "Waiting to send",
    actions: [],
  })
  // Offline, a 5xx and a 429 all wait and go again: the reader sees the same quiet line.
  for (const status of [0, 500, 503, 429, 408])
    assert.equal(deliveryLine(pending({ status, why: "Busy" }), written, written + 5_000)?.state, "waiting")
})

test("a 401 asks the reader to sign in, at once, or to discard it", () => {
  assert.deepEqual(deliveryLine(pending({ status: 401, why: "Sign in again." }), written, written), {
    state: "sign-in",
    text: "Sign in to send",
    actions: ["sign-in", "discard"],
  })
})

test("a 402 says the plan's sentence and sends again on request", () => {
  const why = "This Drop has reached its comment limit."
  assert.deepEqual(deliveryLine(pending({ status: 402, why }), written, written), {
    state: "plan",
    text: why,
    actions: ["retry"],
  })
})

test("a 404 says the drop takes no comments, with Copy and Discard", () => {
  for (const status of [403, 404])
    assert.deepEqual(deliveryLine(failed(status, "Not found"), written, written), {
      state: "gone",
      text: "This drop no longer takes comments",
      actions: ["copy", "discard"],
    })
})

test("a 400, 413 or 415 says the server's sentence, with Edit and Discard", () => {
  for (const [status, why] of [
    [400, "A comment holds at most 10,000 characters."],
    [413, "That image is over 4 MiB."],
    [415, "Images must be PNG, JPEG, WebP, or GIF."],
  ])
    assert.deepEqual(deliveryLine(failed(status, why), written, written), {
      state: "refused",
      text: why,
      actions: ["edit", "discard"],
    })
  assert.equal(deliveryLine(failed(422, ""), written, written)?.text, "The server didn't take this comment")
})

test("pins and rows say 'Waiting to send' or 'Not sent' where the number goes", () => {
  assert.equal(waitingLabel(pending()), "Waiting to send")
  assert.equal(waitingLabel(failed(404, "")), "Not sent")
})

test("the dock counts comments and replies still on their way, past their quiet start, and not refused ones", () => {
  const now = 10_000
  const item = (createdAt, delivery) => ({ createdAt, ...(delivery ? { delivery } : {}), replies: [] })
  const comments = [
    item(1_000),
    { ...item(1_000, pending()), replies: [item(2_000, pending()), item(now - 500, pending()), item(1_000)] },
    item(1_000, failed(404, "")),
    item(1_000, pending({ status: 401, why: "" })),
  ]
  assert.equal(waitingCount(comments, now), 3)
  assert.equal(waitingCount([item(1_000)], now), 0)
})
