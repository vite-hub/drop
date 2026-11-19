import assert from "node:assert/strict"
import { afterEach, beforeEach, test, vi } from "vite-plus/test"
import { computed, effectScope, onScopeDispose, readonly, ref, shallowRef, toValue, watch } from "vue"
import { createMemoryOutboxStore, replyMessageId } from "vite-hub/comments/client"
import { createEventHook, createInjectionState, useEventListener } from "@vueuse/core"
import { keys } from "../../app/utils/keys.ts"
import { toThread } from "../../app/utils/comment-threads.ts"

// useDrop's sends go through the app's outbox (useCommentsOutbox, on ViteHub's): they return at once, show as waiting,
// and reach Drop's routes once, from whatever page the reader is on by then.
const fetches = []
const refreshed = []
let answer
const ada = { id: "ada", name: "Ada", image: null }
const me = ref(ada)
let app
const confirm = vi.fn()
const signOut = vi.fn(async () => {})
for (const [name, value] of Object.entries({
  computed,
  readonly,
  ref,
  shallowRef,
  toValue,
  watch,
  onScopeDispose,
  effectScope,
  createEventHook,
  createInjectionState,
  useEventListener,
  keys,
  toThread,
  useApi: (_url, options) => ({ data: ref(options.default?.()), refresh: async () => {} }),
  useMe: () => ({ data: me, status: ref("success") }),
  useNotify: () => ({ problem: () => "problem", alert() {}, fail() {} }),
  useCommentsOutbox: () => app,
  useNuxtApp: () => ({ $auth: {} }),
  useUserSession: () => ({ signOut }),
  useConfirm: () => confirm,
  navigateTo: async () => {},
  clearNuxtData: () => {},
  refreshNuxtData: async (key) => void refreshed.push(key),
  quotaFailureOf: () => undefined,
  errorText: (_error, fallback) => fallback,
  $fetch: async (url, options) => {
    const body = options.body instanceof FormData ? JSON.parse(options.body.get("data")) : options.body
    fetches.push({ url, body })
    return answer(url, body)
  },
}))
  vi.stubGlobal(name, value)
// The outbox listens for online and visible pages.
vi.stubGlobal("window", new EventTarget())
vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }))
const { createCommentsOutbox } = await import("../../app/composables/useCommentsOutbox.ts")
const { provideDrop } = await import("../../app/composables/useDrop.ts")
const { useSignOut } = await import("../../app/composables/useSignOut.ts")

const scopes = []
const scoped = (run) => {
  const scope = effectScope()
  scopes.push(scope)
  return { scope, value: scope.run(run) }
}
// Each test gets the app's outbox afresh, as a new page load with an empty browser.
beforeEach(() => {
  me.value = ada
  app = scoped(() => createCommentsOutbox({ store: createMemoryOutboxStore() })).value
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  fetches.length = 0
  refreshed.length = 0
  confirm.mockReset()
  signOut.mockClear()
})
function open(id = "doc") {
  const { scope, value: state } = scoped(() => provideDrop(id))
  const wrote = vi.fn()
  state.onWrote(wrote)
  return { state, wrote, close: () => scope.stop() }
}
const place = { kind: "area", selector: "#chart", ox: 10, oy: 20, ow: 100, oh: 200, label: "Chart" }
const comment = (id, body, requestId) => ({
  ...toDrop(id, body),
  messageId: `${id}-m`,
  n: 1,
  kind: "area",
  selector: "#chart",
  ox: 10,
  oy: 20,
  ow: 100,
  oh: 200,
  label: "Chart",
  requestId,
})
const toDrop = (id, body) => ({
  id,
  body,
  quote: null,
  suggestion: null,
  at: null,
  pdfPage: null,
  ink: null,
  page: null,
  authorId: "ada",
  authorName: "Ada",
  authorImage: null,
  agent: null,
  mentions: [],
  resolved: false,
  resolvedAt: null,
  createdAt: 1,
  editedAt: null,
  version: 1,
  mine: true,
  replies: [],
  attachments: [],
  people: [],
})
const reply = (id, body) => ({ ...toDrop(id, body), replies: undefined })
// No answer at all, as offline: the outbox waits and tries again.
const offline = () => Promise.reject(new TypeError("fetch failed"))

test("a comment sent with no network returns at once, shows waiting, and lands once", { timeout: 10_000 }, async () => {
  let tries = 0
  answer = (_url, body) => (++tries === 1 ? offline() : comment("c1", body.body, body.requestId))
  const { state, wrote } = open()

  const sent = await state.addComment(place, "The chart is cut off")
  assert.ok("value" in sent)
  assert.equal(sent.value.delivery?.status, "pending")
  assert.equal(sent.value.n, 0)
  assert.deepEqual(
    state.list.value.map((item) => [item.body, item.kind, item.selector, item.ow, Boolean(item.delivery)]),
    [["The chart is cut off", "area", "#chart", 100, true]],
  )
  assert.equal(wrote.mock.calls.length, 0, "nothing is announced before the server took it")

  await vi.waitFor(() => assert.equal(state.list.value[0]?.id, "c1"), { timeout: 5_000 })
  assert.deepEqual(
    state.list.value.map((item) => [item.id, item.delivery]),
    [["c1", undefined]],
  )
  assert.equal(fetches.length, 2)
  assert.equal(fetches[0].url, "/api/drops/doc/comments")
  assert.equal(fetches[1].body.requestId, fetches[0].body.requestId, "the resend keeps the retry key")
  assert.equal(fetches[1].body.selector, "#chart")
  assert.equal(wrote.mock.calls.length, 1)
})

test("a reply to a waiting comment waits for it, then lands under it", { timeout: 10_000 }, async () => {
  let tries = 0
  answer = (url, body) => {
    if (url === "/api/drops/doc/comments") return ++tries === 1 ? offline() : comment("c1", body.body, body.requestId)
    return reply("r1", body.body)
  }
  const { state, wrote } = open()

  const parent = await state.addComment(place, "The chart is cut off")
  const sent = await state.addReply(parent.value.id, "Also on mobile")
  assert.ok("value" in sent)
  assert.equal(sent.value.delivery?.status, "pending")
  assert.deepEqual(
    state.list.value.map((item) => [item.body, item.replies.map((r) => [r.body, Boolean(r.delivery)])]),
    [["The chart is cut off", [["Also on mobile", true]]]],
  )

  await vi.waitFor(() => assert.equal(state.list.value[0]?.replies[0]?.id, "r1"), { timeout: 5_000 })
  assert.deepEqual(
    fetches.map((item) => item.url),
    ["/api/drops/doc/comments", "/api/drops/doc/comments", "/api/comments/c1/replies"],
  )
  assert.deepEqual(
    state.list.value.map((item) => [item.id, item.replies.map((r) => [r.id, r.delivery])]),
    [["c1", [["r1", undefined]]]],
  )
  assert.equal(wrote.mock.calls.length, 2)
})

test("a waiting reply and its server copy, loaded before the reply's own answer, show once", async () => {
  // The reply reached the server, but its answer was lost: the outbox waits to resend it.
  answer = offline
  const { state } = open()
  state.comments.data.value = [comment("c1", "The chart is cut off")]
  const sent = await state.addReply("c1", "Also on mobile")
  assert.equal(sent.value.delivery?.status, "pending")
  const { requestId } = app.entries.value[0]

  // A list loaded meanwhile (another viewer's comment, a reload) holds the server's copy, with the id the server
  // derives from the retry key and without the key itself.
  const id = await replyMessageId("c1", requestId)
  state.comments.data.value = [{ ...comment("c1", "The chart is cut off"), replies: [reply(id, "Also on mobile")] }]
  await vi.waitFor(() =>
    assert.deepEqual(
      state.list.value[0].replies.map((item) => [item.id, Boolean(item.delivery)]),
      [[id, false]],
    ),
  )
  assert.equal(app.entries.value.length, 1, "the outbox still holds it until its resend answers")
})

test(
  "a comment still waiting when the reader leaves the drop goes out from the next page",
  { timeout: 10_000 },
  async () => {
    let tries = 0
    answer = (_url, body) => (++tries === 1 ? offline() : comment("c1", body.body, body.requestId))
    const { state, wrote, close } = open()

    await state.addComment(place, "The chart is cut off")
    close()
    assert.equal(app.entries.value.length, 1, "the dashboard still counts it")

    await vi.waitFor(() => assert.equal(app.entries.value.length, 0), { timeout: 5_000 })
    assert.equal(fetches.length, 2)
    assert.equal(fetches[1].body.requestId, fetches[0].body.requestId)
    assert.ok(refreshed.includes("comments:doc"), "the drop's list loads again next time it shows")
    assert.equal(wrote.mock.calls.length, 0, "the closed page heard nothing")
  },
)

test("closing the tab asks while a comment waits, and not once it's gone", { timeout: 10_000 }, async () => {
  const unload = () => {
    const event = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  let online = false
  answer = (_url, body) => (online ? comment("c1", body.body, body.requestId) : offline())
  const { state, close } = open()
  assert.equal(unload(), false, "nothing waits")

  await state.addComment(place, "The chart is cut off")
  close()
  assert.equal(unload(), true, "one waits, on another page")

  online = true
  await vi.waitFor(() => assert.equal(app.entries.value.length, 0), { timeout: 5_000 })
  assert.equal(unload(), false)
})

test("signing out with an unsent comment asks, stays on no, and discards it on yes", async () => {
  answer = offline
  const { state } = open()
  const leave = useSignOut()

  await leave()
  assert.equal(confirm.mock.calls.length, 0, "nothing waits, so it doesn't ask")
  assert.equal(signOut.mock.calls.length, 1)

  await state.addComment(place, "The chart is cut off")
  confirm.mockResolvedValueOnce(false)
  await leave()
  assert.match(confirm.mock.calls[0][0].title, /^1 comment isn't sent\. Sign out and discard it\?$/)
  assert.equal(signOut.mock.calls.length, 1, "no: still signed in")
  assert.equal(app.entries.value.length, 1, "no: the comment stays")

  confirm.mockResolvedValueOnce(true)
  await leave()
  assert.equal(app.entries.value.length, 0, "yes: discarded")
  assert.equal(signOut.mock.calls.length, 2)
  assert.equal(state.list.value.length, 0)
})

test(
  "a 401 holds the comment until the same person signs in again, then it goes out as them",
  { timeout: 10_000 },
  async () => {
    const signedOut = () => Promise.reject(Object.assign(new Error("Sign in again to send it."), { status: 401 }))
    let session = "nobody"
    answer = (_url, body) => (body.as === session ? comment("c1", body.body, body.requestId) : signedOut())
    const { state } = open()

    await state.addComment(place, "The chart is cut off")
    await vi.waitFor(() => assert.equal(app.entries.value[0]?.held, true), { timeout: 5_000 })
    assert.equal(fetches[0].body.as, "ada", "it says who wrote it")
    assert.ok(refreshed.includes("me"), "a 401 asks who's signed in now")

    // /api/me says nobody: the guests' outbox runs, and Ada's comment stays saved without going out.
    me.value = null
    await vi.waitFor(() => assert.equal(app.account.value, "guest"))
    assert.equal(app.entries.value.length, 0)
    assert.equal(state.list.value.length, 0)

    session = "ada"
    me.value = ada
    await vi.waitFor(() => assert.equal(state.list.value[0]?.id, "c1"), { timeout: 5_000 })
    assert.deepEqual(
      fetches.map((item) => item.body.as),
      ["ada", "ada"],
    )
    assert.equal(app.entries.value.length, 0)
  },
)

test("a guest's comment says nobody's name", { timeout: 10_000 }, async () => {
  me.value = null
  // The guests' outbox takes over once Vue runs the watcher.
  await new Promise((resolve) => setTimeout(resolve))
  answer = (_url, body) => comment("c1", body.body, body.requestId)
  const { state } = open()

  await state.addComment(place, "The chart is cut off")
  await vi.waitFor(() => assert.equal(state.list.value[0]?.id, "c1"), { timeout: 5_000 })
  assert.equal("as" in fetches[0].body, false)
})

test(
  "a waiting comment's and reply's images show from the browser, and their addresses go once they land",
  { timeout: 10_000 },
  async () => {
    const made = []
    const revoked = []
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      made.push(blob)
      return `blob:local/${made.length}`
    })
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => void revoked.push(url))
    let online = false
    answer = (url, body) => {
      if (!online) return offline()
      return url === "/api/drops/doc/comments" ? comment("c1", body.body, body.requestId) : reply("r1", body.body)
    }
    const { state } = open()
    const shot = new File(["png"], "screenshot.png", { type: "image/png" })
    const pasted = new File(["gif"], "pasted.gif", { type: "image/gif" })

    const parent = await state.addComment(place, "The chart is cut off", [shot])
    await state.addReply(parent.value.id, "Here it is on mobile", [pasted])
    const [waiting] = state.list.value
    assert.deepEqual(
      waiting.attachments.map((file) => [file.filename, file.contentType, file.size, file.url]),
      [["screenshot.png", "image/png", 3, "blob:local/1"]],
    )
    assert.deepEqual(
      waiting.replies[0].attachments.map((file) => [file.filename, file.url]),
      [["pasted.gif", "blob:local/2"]],
    )
    // The list is computed again on every change; each image keeps the one address.
    state.comments.data.value = []
    assert.equal(state.list.value[0].attachments[0].url, "blob:local/1")
    assert.equal(made.length, 2)
    assert.deepEqual(revoked, [])

    online = true
    await vi.waitFor(() => assert.equal(app.entries.value.length, 0), { timeout: 5_000 })
    await vi.waitFor(() => assert.deepEqual(revoked.toSorted(), ["blob:local/1", "blob:local/2"]))
    vi.restoreAllMocks()
  },
)

test("a waiting image's address goes when the page closes", async () => {
  const revoked = []
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:local/1")
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => void revoked.push(url))
  answer = offline
  const { state, close } = open()
  await state.addComment(place, "The chart is cut off", [new File(["png"], "chart.png", { type: "image/png" })])
  assert.equal(state.list.value[0].attachments[0].url, "blob:local/1")
  close()
  assert.deepEqual(revoked, ["blob:local/1"])
  vi.restoreAllMocks()
})
