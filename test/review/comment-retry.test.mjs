import assert from "node:assert/strict"
import { beforeEach, test } from "vite-plus/test"
import { H3Event, toResponse } from "h3"
import { insertDrop, insertVersion, migrate, objects, reset, sql, state, threads, who } from "../cost/harness.mjs"
const { signReviewToken } = await import("../../server/utils/review.ts")
const { default: dropCommentsPost } = await import("../../server/api/drops/[id]/comments.post.ts")
const { default: dropComments } = await import("../../server/api/drops/[id]/comments.get.ts")
const { default: replyPost } = await import("../../server/api/comments/[id]/replies.post.ts")
const { default: externalCommentPost } = await import("../../server/api/review/comments.post.ts")
const { default: siteReplyPost } = await import("../../server/api/review/comments/[n]/replies.post.ts")
const { default: siteCommentPost } = await import("../../server/api/drops/[id]/review.post.ts")
const { default: commentPatch } = await import("../../server/api/comments/[id]/index.patch.ts")
const { default: commentDelete } = await import("../../server/api/comments/[id]/index.delete.ts")
const { default: replyDelete } = await import("../../server/api/comments/[id]/replies/[messageId].delete.ts")

// A comment's retry key (`requestId`): a client that lost the answer sends the same comment again, and gets the first
// one back, with nothing stored twice.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const SITE = "https://pr12-acme.preview.example.com"
const KEY = "4b0c2a3e-6f1d-4c3b-9a8e-2d7f5e1c0b9a"
const ada = { ...who, userId: "ada", name: "Ada", email: "ada@example.com", actorName: "Ada" }

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

test("a retry pinned to an older displayed revision stays there after publish", async () => {
  insertDrop("doc", { version: 4 })
  insertVersion("doc", 3)
  state.who = who
  const send = () =>
    dropCommentsPost(request("/api/drops/doc/comments?v=3", { method: "POST", body: form(page({ requestId: KEY })) }))
  const first = await send()
  assert.equal(first.version, 3)
  assert.equal((await send()).id, first.id)
})

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

test("a guest's lost-answer resend after signing in, from the same browser, gets the guest's comment and reply back", async () => {
  insertDrop("doc", { visibility: "public", access: "comment" })
  state.who = null
  const read = request("/api/drops/doc/comments")
  await dropComments(read)
  const cookie = cookieOf(read)
  const first = await dropCommentsPost(commentOn(page({ requestId: KEY }), { cookie }))
  const replyKey = crypto.randomUUID()
  const reply = await replyPost(replyIn(first.id, { body: "And this", requestId: replyKey }, { cookie }))
  const stored = images()

  // The answers were lost, and the guest signed in: the outbox sends both again as them, from the same browser.
  state.who = who
  const again = await dropCommentsPost(commentOn(page({ requestId: KEY, as: who.userId }), { cookie }))
  assert.equal(again.id, first.id)
  const replied = await replyPost(
    replyIn(first.id, { body: "And this", requestId: replyKey, as: who.userId }, { cookie }),
  )
  assert.equal(replied.id, reply.id)
  assert.equal(threads().length, 1)
  assert.equal(threads()[0].messages.length, 2)
  assert.equal(images(), stored)

  // Someone signed in on another browser still can't take the key.
  state.who = ada
  assert.equal((await answer(dropCommentsPost, commentOn(page({ requestId: KEY, as: ada.userId })))).status, 409)
  const other = replyIn(first.id, { body: "And this", requestId: replyKey, as: ada.userId })
  assert.equal((await answer(replyPost, other)).status, 409)
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
  // Cloudflare's binding doesn't, so the 429 doesn't say and the client backs off on its own.
  state.burstRetryAfter = undefined
  const cloudflare = await send()
  assert.equal(cloudflare.status, 429)
  assert.equal(cloudflare.headers.get("retry-after"), null)
  assert.match((await cloudflare.json()).message, /Too many comments in a minute/)
  assert.equal(threads().length, 0)
})

test.each([
  ["/api/review/comments", externalCommentPost],
  ["/api/review/comments/1/replies", siteReplyPost],
])("%s exposes the limiter's retry interval and message to the review origin", async (path, post) => {
  insertDrop("site", { kind: "site", blob_key: null, filename: "site", site_url: SITE })
  state.failBurst = true
  const { token } = await signReviewToken(request("/"), { d: "site", u: "owner", n: "Owner", o: SITE })
  const send = () =>
    answer(
      post,
      request(path, {
        method: "POST",
        params: { n: "1" },
        headers: { origin: SITE, authorization: `Bearer ${token}` },
      }),
    )
  const response = await send()
  assert.equal(response.status, 429)
  assert.equal(response.headers.get("retry-after"), "42")
  assert.equal(response.headers.get("access-control-expose-headers"), "Retry-After")
  assert.equal(response.headers.get("access-control-allow-origin"), SITE)
  assert.equal(response.headers.get("vary"), "Origin")
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.match((await response.json()).message, /Too many comments in a minute/)
  state.burstRetryAfter = undefined
  const withoutInterval = await send()
  assert.equal(withoutInterval.headers.get("retry-after"), null)
  assert.match((await withoutInterval.json()).message, /Too many comments in a minute/)
})

test("a comment or reply sent as someone the session isn't gets 401 and stores nothing", async () => {
  insertDrop("doc", { visibility: "public", access: "comment" })
  state.who = who
  const thread = await dropCommentsPost(commentOn(page({ as: "owner" })))
  assert.equal(threads().length, 1)
  const stored = images()

  // Signed out: a guest may comment here, but this was written as the owner.
  state.who = null
  const signedOut = commentOn(page({ as: "owner", requestId: KEY }))
  const refused = await answer(dropCommentsPost, signedOut)
  assert.equal(refused.status, 401)
  assert.equal(signedOut.context.dropSessionCookies, undefined, "no guest cookie either")
  assert.equal((await answer(replyPost, replyIn(thread.id, { body: "And this", as: "owner" }))).status, 401)
  // Someone else signed in.
  state.who = ada
  assert.equal((await answer(dropCommentsPost, commentOn(page({ as: "owner" })))).status, 401)
  assert.equal((await answer(replyPost, replyIn(thread.id, { body: "And this", as: "owner" }))).status, 401)
  assert.equal(threads().length, 1)
  assert.equal(threads()[0].messages.length, 1)
  assert.equal(images(), stored)

  // Without `as`, a guest's send goes out as before.
  state.who = null
  assert.equal((await answer(dropCommentsPost, commentOn(page()))).status, 200)
})

test("signed out of a drop only its people see, a send as its owner gets 401, not 404", async () => {
  insertDrop("doc", { visibility: "private" })
  insertDrop("site", { visibility: "private", kind: "site", blob_key: null, filename: "site", site_url: SITE })
  state.who = who
  const thread = await dropCommentsPost(commentOn(page()))
  state.who = null
  assert.equal((await answer(dropCommentsPost, commentOn(page({ as: "owner" })))).status, 401)
  assert.equal((await answer(replyPost, replyIn(thread.id, { body: "And this", as: "owner" }))).status, 401)
  const frame = (data) =>
    answer(
      siteCommentPost,
      request(`/api/drops/site/review?origin=${encodeURIComponent(SITE)}`, {
        method: "POST",
        body: form({ body: "From the frame", page: "/", ox: 0, oy: 0, ow: 10, oh: 10, ...data }),
        id: "site",
      }),
    )
  assert.equal((await frame({ as: "owner" })).status, 401)
  // Without `as`, it's the same refusal as ever.
  assert.equal((await answer(dropCommentsPost, commentOn(page()))).status, 404)
  assert.equal((await frame({})).status, 404)
  assert.equal(threads().length, 1)
  assert.equal(threads()[0].messages.length, 1)
  assert.equal(images(), 1)
})

test("a guest resolves and deletes nothing, their own comments and replies included", async () => {
  insertDrop("doc", { visibility: "public", access: "comment" })
  state.who = null
  const read = request("/api/drops/doc/comments")
  await dropComments(read)
  const cookie = cookieOf(read)
  const json = { "content-type": "application/json", cookie }
  const thread = await dropCommentsPost(commentOn(page(), { cookie }))
  const reply = await replyPost(replyIn(thread.id, { body: "And this" }, { cookie }))
  assert.deepEqual([thread.mine, reply.mine], [true, true])

  const resolve = await answer(
    commentPatch,
    request(`/api/comments/${thread.id}`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ resolved: true }),
      id: thread.id,
    }),
  )
  assert.equal(resolve.status, 404)
  const removeReply = await answer(
    replyDelete,
    request(`/api/comments/${thread.id}/replies/${reply.id}`, {
      method: "DELETE",
      headers: { cookie },
      id: thread.id,
      params: { messageId: reply.id },
    }),
  )
  assert.equal(removeReply.status, 404)
  const remove = await answer(
    commentDelete,
    request(`/api/comments/${thread.id}`, { method: "DELETE", headers: { cookie }, id: thread.id }),
  )
  assert.equal(remove.status, 404)
  const [listed] = threads()
  assert.equal(listed.status, "open")
  assert.equal(listed.messages.length, 2)
})

test("a comment's retry key comes back to its author only", async () => {
  insertDrop("doc", { visibility: "public", access: "comment" })
  state.who = who
  const sent = await dropCommentsPost(commentOn(page({ requestId: KEY })))
  assert.equal(sent.requestId, KEY)
  await replyPost(replyIn(sent.id, { body: "And this", requestId: crypto.randomUUID() }))
  const [mine] = await dropComments(request("/api/drops/doc/comments"))
  assert.equal(mine.requestId, KEY)
  assert.equal(
    "requestId" in mine.replies[0],
    false,
    "the viewer finds a reply by the id its key gives (replyMessageId)",
  )
  state.who = ada
  const [theirs] = await dropComments(request("/api/drops/doc/comments"))
  assert.equal(theirs.mine, false)
  assert.equal("requestId" in theirs, false)
  state.who = null
  const [guest] = await dropComments(request("/api/drops/doc/comments"))
  assert.equal("requestId" in guest, false)
})
