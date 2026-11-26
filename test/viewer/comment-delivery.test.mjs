import assert from "node:assert/strict"
import { test } from "vite-plus/test"
import {
  deliveryLine,
  STUCK_SENDING_MS,
  troubleCount,
  waitingCount,
  waitingLabel,
  WAITING_NOTICE_MS,
} from "../../app/utils/comment-delivery.ts"

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

// A burst of comments on their way shows nothing: the pending pins say they're going. Counts show trouble only.
const entry = (status, extra = {}) => ({ status, requestId: `r${Math.random()}`, files: [], ...extra })
const clock = (since = new Map(), online = true, now = 10_000) => ({
  now,
  online,
  sendingSince: (requestId) => since.get(requestId),
})

test("a healthy burst on its way counts nothing", () => {
  const head = entry("sending")
  const burst = [head, entry("pending"), entry("pending")]
  assert.equal(troubleCount(burst, clock(new Map([[head.requestId, 9_000]]))), 0)
})

test("refused, held, erroring and retrying entries count", () => {
  assert.equal(troubleCount([entry("failed", { error: { status: 404, why: "" } }), entry("pending")], clock()), 1)
  assert.equal(troubleCount([entry("pending", { held: true, error: { status: 401, why: "" } })], clock()), 1)
  assert.equal(troubleCount([entry("pending", { error: { status: 503, why: "Busy" }, retryAt: 12_000 })], clock()), 1)
  // A retry going out again still carries the error it's retrying.
  assert.equal(troubleCount([entry("sending", { error: { status: 0, why: "" } })], clock()), 1)
})

test("offline, everything queued counts", () => {
  assert.equal(troubleCount([entry("pending"), entry("pending")], clock(new Map(), false)), 2)
})

test("a queue head sending for more than 5 s counts", () => {
  const head = entry("sending")
  const since = new Map([[head.requestId, 10_000 - STUCK_SENDING_MS - 1]])
  assert.equal(troubleCount([head, entry("pending")], clock(since)), 1)
  since.set(head.requestId, 10_000 - STUCK_SENDING_MS + 1)
  assert.equal(troubleCount([head, entry("pending")], clock(since)), 0)
})

test("the dock counts comments and replies in trouble, from their deliveries", () => {
  const item = (delivery) => ({ ...(delivery ? { delivery } : {}), replies: [] })
  const comments = [
    item(),
    { ...item(pending()), replies: [item(pending()), item(failed(404, "")), item()] },
    item(pending({ status: 401, why: "" })),
  ]
  assert.equal(waitingCount(comments, clock()), 2)
  assert.equal(waitingCount([item(pending())], clock()), 0)
})
