import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { insertDrop, migrate, objects, reset, sql, state, threads, who } from "../cost/harness.mjs"
const { signReviewToken } = await import("../../server/utils/review.ts")
const { default: dropCommentsPost } = await import("../../server/api/drops/[id]/comments.post.ts")
const { default: dropComments } = await import("../../server/api/drops/[id]/comments.get.ts")
const { default: replyPost } = await import("../../server/api/comments/[id]/replies.post.ts")
const { default: siteReplyPost } = await import("../../server/api/review/comments/[n]/replies.post.ts")

// A comment's retry key (`requestId`): a client that lost the answer sends the same comment again, and gets the first
// one back, with nothing stored twice.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const SITE = "https://pr12-acme.preview.example.com"
const KEY = "4b0c2a3e-6f1d-4c3b-9a8e-2d7f5e1c0b9a"

migrate()
beforeEach(() => {
  reset()
  state.authSecret = "test-secret"
})

function request(path, { method = "GET", headers = {}, body, id = "doc", params = {} } = {}) {
  const event = new H3Event(new Request(`https://drop.example${path}`, { method, headers, body }))
  event.context.log = { set() {}, error() {}, warn() {} }
  event.context.params = { id, ...params }
  return event
}
async function answer(handler, event) {
  const value = await Promise.resolve()
    .then(() => handler(event))
    .catch((error) => error)
  return toResponse(value, event)
}

/** A comment's or reply's multipart body: its JSON, and one image. */
function form(data) {
  const body = new FormData()
  body.append("data", JSON.stringify(data))
  body.append("image", new Blob([PNG]), "mock.png")
  return body
}
const page = (extra = {}) => ({ kind: "page", selector: "", ox: 0, oy: 0, body: "Like this", ...extra })
const commentOn = (data, headers = {}) =>
  request("/api/drops/doc/comments", { method: "POST", body: form(data), headers })
const replyIn = (thread, data, headers = {}) =>
  request(`/api/comments/${thread}/replies`, { method: "POST", body: form(data), id: thread, headers })
const images = () => sql.prepare("SELECT count(*) AS n FROM drops WHERE parent_id = 'doc' AND kind = 'image'").get().n
/** The browser's guest cookie from what a request set, as the browser sends it back. */
const cookieOf = (event) => event.context.dropSessionCookies?.[0]?.split(";")[0]

test("a comment with an image sent twice is one thread and one stored image", async () => {
  insertDrop("doc")
  state.who = who
  const first = await dropCommentsPost(commentOn(page({ requestId: KEY })))
  const again = await dropCommentsPost(commentOn(page({ requestId: KEY })))
  assert.equal(again.id, first.id)
  assert.equal(again.n, first.n)
  assert.deepEqual(
    again.attachments.map((file) => file.id),
    first.attachments.map((file) => file.id),
  )
  assert.equal(again.mine, true)
  assert.equal(threads().length, 1)
  assert.equal(images(), 1)
  assert.equal(objects.size, 2, "the drop's source and one image")

  // Another key is another comment.
  await dropCommentsPost(commentOn(page({ requestId: crypto.randomUUID() })))
  assert.equal(threads().length, 2)
})

test("two sends of one comment at once store one thread and one image", async () => {
  insertDrop("doc")
  state.who = who
  const [first, second] = await Promise.all([
    dropCommentsPost(commentOn(page({ requestId: KEY }))),
    dropCommentsPost(commentOn(page({ requestId: KEY }))),
  ])
  assert.equal(second.id, first.id)
  assert.equal(second.attachments.length, 1)
  assert.equal(threads().length, 1)
  assert.equal(images(), 1)
})

test("a reply with an image sent twice is one reply and one stored image", async () => {
  insertDrop("doc")
  state.who = who
  const thread = await dropCommentsPost(
    request("/api/drops/doc/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(page()),
    }),
  )
  const first = await replyPost(replyIn(thread.id, { body: "And this", requestId: KEY }))
  const again = await replyPost(replyIn(thread.id, { body: "And this", requestId: KEY }))
  assert.equal(again.id, first.id)
  assert.deepEqual(
    again.attachments.map((file) => file.id),
    first.attachments.map((file) => file.id),
  )
  assert.equal(threads()[0].messages.length, 2)
  assert.equal(images(), 1)
})

test("a guest's resend is theirs: the same thread, with mine, from their browser's cookie", async () => {
  insertDrop("doc", { visibility: "public", access: "comment" })
  state.who = null
  // Reading the comments gives the guest their cookie before they write.
  const read = request("/api/drops/doc/comments")
  await dropComments(read)
  const cookie = cookieOf(read)
  assert.match(cookie, /^__Host-drop_guest=[\da-f]{32}$/)
  assert.match(read.context.dropSessionCookies[0], /HttpOnly; SameSite=Lax; Secure$/)

  const first = await dropCommentsPost(commentOn(page({ requestId: KEY }), { cookie }))
  const again = await dropCommentsPost(commentOn(page({ requestId: KEY }), { cookie }))
  assert.equal(again.id, first.id)
  assert.equal(first.mine, true)
  assert.equal(again.mine, true)
  assert.equal(images(), 1)
  assert.match(first.authorId, /^guest:[\da-f]{32}$/)
  assert.ok(!first.authorId.includes(cookie.split("=")[1]), "the id isn't the cookie")

  const reply = await replyPost(replyIn(first.id, { body: "And this", requestId: crypto.randomUUID() }, { cookie }))
  assert.equal(reply.mine, true)
  const [listed] = await dropComments(request("/api/drops/doc/comments", { headers: { cookie } }))
  assert.deepEqual([listed.mine, listed.replies[0].mine], [true, true])
  const [stranger] = await dropComments(request("/api/drops/doc/comments"))
  assert.equal(stranger.mine, false, "another browser's guest")

  // Another browser can't take the guest's key, nor their comment, and stores nothing trying.
  const stored = images()
  const other = await answer(
    dropCommentsPost,
    commentOn(page({ requestId: KEY }), { cookie: "__Host-drop_guest=00000000000000000000000000000000" }),
  )
  assert.equal(other.status, 409)
  assert.equal(threads().length, 1)
  assert.equal(images(), stored)
})

test("a site reply sent twice from the review script is one reply", async () => {
  insertDrop("site", { kind: "site", blob_key: null, filename: "site", site_url: SITE })
  state.who = who
  await dropCommentsPost(
    request("/api/drops/site/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(page()),
      id: "site",
    }),
  )
  const { token } = await signReviewToken(request("/"), { d: "site", u: "owner", n: "Owner", o: SITE })
  const send = () =>
    answer(
      siteReplyPost,
      request("/api/review/comments/1/replies", {
        method: "POST",
        headers: { origin: SITE, authorization: `Bearer ${token}` },
        body: form({ body: "From the page", requestId: KEY }),
        id: "site",
        params: { n: "1" },
      }),
    )
  assert.equal((await send()).status, 200)
  assert.equal((await send()).status, 200)
  assert.equal(threads()[0].messages.length, 2)
  assert.equal(sql.prepare("SELECT count(*) AS n FROM drops WHERE parent_id = 'site'").get().n, 1)
})

test("past the limit, a comment's 429 says when to send again", async () => {
  insertDrop("doc")
  state.who = who
  state.failBurst = true
  const send = () =>
    answer(
      dropCommentsPost,
      request("/api/drops/doc/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(page({ requestId: KEY })),
      }),
    )
  // ViteHub's in-memory limiter knows when its window ends.
  const counted = await send()
  assert.equal(counted.status, 429)
  assert.equal(counted.headers.get("retry-after"), "42")
  // Cloudflare's binding doesn't: the whole window.
  state.burstRetryAfter = undefined
  const cloudflare = await send()
  assert.equal(cloudflare.status, 429)
  assert.equal(cloudflare.headers.get("retry-after"), "60")
  assert.equal(threads().length, 0)
})
