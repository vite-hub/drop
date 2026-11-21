import assert from "node:assert/strict"
import { setImmediate } from "node:timers/promises"
import { afterEach, beforeEach, test, vi } from "vite-plus/test"
import { computed, effectScope, onScopeDispose, readonly, ref, shallowRef, toValue, watch } from "vue"
import { createMemoryOutboxStore, replyMessageId } from "vite-hub/comments/client"
import { createEventHook, createInjectionState, useEventListener, useTimeoutFn } from "@vueuse/core"
import { keys } from "../../app/utils/keys.ts"
import { toThread } from "../../app/utils/comment-threads.ts"
import { RETURNING_COOKIE } from "../../shared/sign-in.ts"

// useDrop's sends go through the app's outbox (useCommentsOutbox, on ViteHub's): they return at once, show as waiting,
// and reach Drop's routes once, from whatever page the reader is on by then.
const fetches = []
const refreshed = []
// What a page's own list loaded again (useApi's refresh), apart from refreshNuxtData's keys.
const pageRefreshes = []
const saved = new Map()
let answer
const ada = { id: "ada", name: "Ada", image: null }
const me = ref(ada)
const identityStatus = ref("success")
const resolveIdentity = vi.fn()
const returning = ref("1")
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
  useTimeoutFn,
  keys,
  toThread,
  useApi: (_url, options) => ({
    data: ref(options.default?.()),
    refresh: async () => void pageRefreshes.push(toValue(options.key)),
  }),
  reportClientError: () => {},
  localStorage: {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => void saved.set(key, String(value)),
    removeItem: (key) => void saved.delete(key),
  },
  useMe: () => ({ data: me, status: identityStatus }),
  useNotify: () => ({ problem: () => "problem", alert() {}, fail() {} }),
  useCommentsOutbox: () => app,
  useNuxtApp: () => ({ $auth: {} }),
  useUserSession: () => ({ signOut }),
  useCookie: (name) => {
    assert.equal(name, RETURNING_COOKIE)
    return returning
  },
  useConfirm: () => confirm,
  navigateTo: async () => {},
  clearNuxtData: () => {},
  refreshNuxtData: async (key) => {
    refreshed.push(key)
    if (key === "me") await resolveIdentity()
  },
  quotaFailureOf: () => undefined,
  errorText: (_error, fallback) => fallback,
  $fetch: async (url, options) => {
    const body = options.body instanceof FormData ? JSON.parse(options.body.get("data")) : options.body
    fetches.push({ url, body, query: options.query })
    return answer(url, body)
  },
}))
  vi.stubGlobal(name, value)
// Nuxt auto-imports the outbox's utils, which read toThread as they load.
const outboxUtils = await import("../../app/utils/comment-outbox.ts")
for (const [name, value] of Object.entries(outboxUtils)) vi.stubGlobal(name, value)
const { fileUrls } = outboxUtils
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
const durableStore = () => ({ ...createMemoryOutboxStore(), persisted: true })
beforeEach(async () => {
  me.value = ada
  identityStatus.value = "success"
  returning.value = "1"
  app = scoped(() => createCommentsOutbox({ store: durableStore() })).value
  await vi.waitFor(() => app.writable())
})
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  fetches.length = 0
  refreshed.length = 0
  pageRefreshes.length = 0
  saved.clear()
  confirm.mockReset()
  signOut.mockClear()
  resolveIdentity.mockReset()
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

test("memory fallback never accepts comments, site captures or replies", async () => {
  app = scoped(() => createCommentsOutbox({ store: createMemoryOutboxStore() })).value
  answer = offline
  const { state } = open()
  const image = new File(["image"], "note.png", { type: "image/png" })
  assert.ok("error" in (await state.addComment(place, "Draft", [image])))
  assert.equal(await state.addSiteComment("https://example.com", { ...place, page: "/" }, "Draft", [image]), false)
  assert.ok("error" in (await state.addReply("parent", "Draft", [image])))
  assert.equal(app.entries.value.length, 0)
  assert.equal(fetches.length, 0)
})

test.each([
  ["markdown", { v: 3 }],
  ["app", {}],
])("queued comments on the latest %s send to the right revision", async (kind, expected) => {
  const { state } = open()
  state.drop.data.value = { kind, version: 3 }
  answer = offline
  assert.ok("value" in (await state.addComment(place, "On version three")))
  await vi.waitFor(() => assert.equal(fetches.length, 1))
  state.drop.data.value = { kind, version: 4 }
  answer = (_url, body) => comment("saved", body.body, body.requestId)
  await app.retry(app.entries.value[0].id)
  await vi.waitFor(() => assert.equal(app.entries.value.length, 0))
  assert.deepEqual(
    fetches.map(({ query }) => query),
    [expected, expected],
  )
})

test("a reply to a queued site screenshot uses its actual thread ID after replay", async () => {
  const { state } = open("site")
  const shot = new Blob(["screenshot"], { type: "image/png" })
  let tries = 0
  answer = (url, body) => {
    if (url.endsWith("/review")) return ++tries === 1 ? offline() : { id: "site-thread", n: 1 }
    assert.equal(url, "/api/comments/site-thread/replies")
    return reply("site-reply", body.body)
  }
  assert.equal(await state.addSiteComment("https://example.com", { ...place, page: "/" }, "Screenshot", [shot]), true)
  const parent = state.list.value[0]
  assert.ok("value" in (await state.addReply(parent.id, "Under screenshot")))
  await vi.waitFor(() => assert.equal(app.entries.value.length, 0), { timeout: 5_000 })
  assert.equal(fetches.length, 3)
  assert.equal(fetches[0].body.requestId, fetches[1].body.requestId)
  assert.equal(fetches[2].url, "/api/comments/site-thread/replies")
})

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
    assert.ok(
      refreshed.some((key) => key.includes("comments:doc")),
      "the drop's list loads again next time it shows",
    )
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

test(
  "a comment refused after a try that got no answer can still be discarded or edited",
  { timeout: 10_000 },
  async () => {
    // The drop went to the Trash while the reader was offline: no answer, then 404.
    let tries = 0
    const gone = () => Promise.reject(Object.assign(new Error("You can't comment on this drop."), { status: 404 }))
    answer = () => (++tries === 1 ? offline() : gone())
    const { state } = open()
    await state.addComment(place, "First")
    await vi.waitFor(() => assert.equal(app.entries.value[0]?.status, "failed"), { timeout: 5_000 })
    const [first] = app.entries.value
    assert.equal(first.uncertain, true, "ViteHub can't tell whether the first try landed")

    assert.equal(await app.edit(first.id, "First, shorter"), true)
    await vi.waitFor(() => assert.equal(fetches.at(-1).body.body, "First, shorter"), { timeout: 5_000 })
    assert.equal(fetches.at(-1).body.requestId, first.requestId, "the edit keeps the retry key")
    await vi.waitFor(() => assert.equal(app.entries.value[0]?.status, "failed"), { timeout: 5_000 })

    const sends = fetches.length
    assert.equal(await app.discard(first.id), true)
    assert.equal(app.entries.value.length, 0)
    assert.deepEqual(state.list.value, [])
    assert.equal(fetches.length, sends, "a discarded comment isn't sent again")
  },
)

test("signing out with an unsent comment asks, stays on no, and discards it on yes", async () => {
  answer = offline
  const { state } = open()
  const leave = useSignOut()

  await leave()
  assert.equal(confirm.mock.calls.length, 0, "nothing waits, so it doesn't ask")
  assert.equal(signOut.mock.calls.length, 1)
  assert.equal(returning.value, null)

  await state.addComment(place, "The chart is cut off")
  returning.value = "1"
  confirm.mockResolvedValueOnce(false)
  await leave()
  assert.match(confirm.mock.calls[0][0].title, /^1 comment isn't sent\. Sign out and discard it\?$/)
  assert.equal(signOut.mock.calls.length, 1, "no: still signed in")
  assert.equal(app.entries.value.length, 1, "no: the comment stays")
  assert.equal(returning.value, "1", "no: the sign-in preference stays")

  confirm.mockResolvedValueOnce(true)
  await leave()
  assert.equal(app.entries.value.length, 0, "yes: discarded")
  assert.equal(signOut.mock.calls.length, 2)
  assert.equal(returning.value, null, "yes: the next drop link won't sign in automatically")
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

    // /api/me says nobody: only a redacted recovery entry remains.
    me.value = null
    const sends = fetches.length
    await vi.waitFor(() => assert.equal(app.heldIds.value.length, 1))
    assert.equal(app.account.value, "guest")
    assert.deepEqual(app.entries.value, [])
    assert.deepEqual(state.list.value, [])
    assert.equal(fetches.length, sends, "nothing goes out while she's signed out")
    const unload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(unload)
    assert.equal(unload.defaultPrevented, true, "closing the tab still asks")

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

test(
  "a guest sends independently of a held account and can discard its uncertain entry",
  {
    timeout: 10_000,
  },
  async () => {
    const signedOut = () => Promise.reject(Object.assign(new Error("Sign in again to send it."), { status: 401 }))
    let tries = 0
    answer = (_url, body) =>
      !body.as ? comment("guest-comment", body.body, body.requestId) : ++tries === 1 ? offline() : signedOut()
    const { state } = open()
    await state.addComment(place, "The chart is cut off")
    await vi.waitFor(() => assert.equal(app.entries.value[0]?.held, true), { timeout: 5_000 })
    assert.ok(saved.size, "whose they are is kept while they wait")

    assert.equal(app.entries.value[0].uncertain, true)
    me.value = null
    await vi.waitFor(() => app.writable())
    await vi.waitFor(() => assert.equal(app.heldIds.value.length, 1))
    const [held] = app.heldIds.value
    await state.addComment(place, "From the guest composer")
    await vi.waitFor(() => assert.ok(state.findComment("guest-comment")))
    assert.equal(fetches.at(-1).body.as, undefined)
    assert.ok(await app.discard(held))
    assert.equal(saved.size, 0, "and forgotten with the last of them")
    assert.equal(app.entries.value.length, 0)
  },
)

test("signing out forgets whose the held comments were", async () => {
  answer = offline
  const { state } = open()
  await state.addComment(place, "The chart is cut off")
  await vi.waitFor(() => assert.ok(saved.size))
  confirm.mockResolvedValueOnce(true)
  await useSignOut()()
  assert.equal(saved.size, 0)
})

test("sign-out confirmation discards the original account's queue after session expiry", async () => {
  answer = offline
  const { state } = open()
  await state.addComment(place, "From Ada")
  await vi.waitFor(() => assert.ok(saved.size))
  confirm.mockImplementationOnce(async () => {
    me.value = null
    await vi.waitFor(() => assert.equal(app.heldIds.value.length, 1))
    await state.addComment(place, "From the guest")
    return true
  })
  await useSignOut()()
  assert.deepEqual(app.heldIds.value, [])
  assert.deepEqual(
    app.entries.value.map((entry) => entry.input.body),
    ["From the guest"],
  )
})

test("a startup identity failure retries on reconnect before replaying a saved comment", async () => {
  const store = durableStore()
  answer = offline
  const first = scoped(() => createCommentsOutbox({ store }))
  app = first.value
  const { state, close } = open()
  await vi.waitFor(() => app.writable())
  await state.addComment(place, "Saved before reload")
  await vi.waitFor(() => assert.equal(fetches.length, 1))
  close()
  first.scope.stop()

  identityStatus.value = "error"
  me.value = null
  app = scoped(() => createCommentsOutbox({ store })).value
  assert.deepEqual(app.entries.value, [])
  await assert.rejects(app.writable())
  resolveIdentity.mockImplementationOnce(() => {
    me.value = ada
    identityStatus.value = "success"
  })
  answer = (_url, body) => comment("c1", body.body, body.requestId)
  window.dispatchEvent(new Event("online"))
  await vi.waitFor(() => assert.equal(fetches.length, 2), { timeout: 5000 })
  assert.equal(fetches[1].body.as, "ada")
  assert.equal(fetches[1].body.requestId, fetches[0].body.requestId)
})

test(
  "a confirmed same-account lookup resumes a 401 hold but not the following quota hold",
  { timeout: 10_000 },
  async () => {
    const refusal = (status) => Promise.reject(Object.assign(new Error("Not sent"), { status }))
    answer = () => refusal(401)
    resolveIdentity.mockImplementationOnce(() => {
      identityStatus.value = "pending"
      me.value = null
      identityStatus.value = "error"
    })
    const { state } = open()
    await state.addComment(place, "Saved before signing back in")
    await vi.waitFor(() => assert.equal(app.entries.value[0]?.error?.status, 401), { timeout: 4_000 })
    assert.equal(identityStatus.value, "error")

    answer = () => refusal(402)
    resolveIdentity.mockImplementationOnce(() => {
      identityStatus.value = "pending"
      me.value = ada
      identityStatus.value = "success"
    })
    window.dispatchEvent(new Event("online"))
    await vi.waitFor(() => assert.equal(app.entries.value[0]?.error?.status, 402), { timeout: 4_000 })
    const [first, second] = fetches
    assert.equal(second.body.as, ada.id)
    assert.equal(second.body.requestId, first.body.requestId)

    identityStatus.value = "error"
    identityStatus.value = "success"
    await setImmediate()
    assert.equal(app.entries.value[0]?.error?.status, 402)
    assert.equal(fetches.length, 2)
    answer = (_url, body) => comment("c1", body.body, body.requestId)
    await app.retry(app.entries.value[0].id)
    await vi.waitFor(() => assert.equal(state.list.value[0]?.id, "c1"))
    assert.equal(fetches.length, 3, "the quota hold needs an explicit retry")
  },
)

test("a guest's waiting comment goes out as the person who signs in, without asking", { timeout: 10_000 }, async () => {
  me.value = null
  await vi.waitFor(() => assert.equal(app.account.value, "guest"))
  let online = false
  answer = (_url, body) => (online ? comment("c1", body.body, body.requestId) : offline())
  const { state } = open()
  await state.addComment(place, "The chart is cut off")
  assert.equal(app.entries.value.length, 1)

  online = true
  me.value = ada
  await vi.waitFor(() => assert.equal(state.list.value[0]?.id, "c1"), { timeout: 5_000 })
  assert.equal(confirm.mock.calls.length, 0)
  assert.equal(fetches.at(-1).body.as, "ada", "it goes out as Ada")
  assert.equal(fetches.at(-1).body.requestId, fetches[0].body.requestId, "with the guest's retry key")
  assert.equal(app.entries.value.length, 0)
})

test("a comment another tab sent loads in this tab's list", { timeout: 10_000 }, async () => {
  // Two tabs of one browser: one store, and messages between them. This tab is offline, the other one sends.
  const store = durableStore()
  const listeners = new Set()
  const tab = (online) => {
    const own = new Set()
    return {
      listen: () => () => {},
      isVisible: () => true,
      isOnline: () => online,
      lock: (_name, task) => task(),
      lead(_name, task) {
        const controller = new AbortController()
        void task(controller.signal)
        return () => controller.abort()
      },
      post: (message) => listeners.forEach((listener) => !own.has(listener) && listener(message)),
      receive(listener) {
        listeners.add(listener)
        own.add(listener)
        return () => listeners.delete(listener)
      },
      schedule(task, ms) {
        const timer = setTimeout(task, ms)
        return () => clearTimeout(timer)
      },
      random: () => 0.5,
    }
  }
  app = scoped(() => createCommentsOutbox({ store, environment: tab(false) })).value
  await vi.waitFor(() => app.writable())
  const { state } = open()
  answer = (_url, body) => comment("c1", body.body, body.requestId)
  await state.addComment(place, "The chart is cut off")
  assert.equal(state.list.value.length, 1)

  scoped(() => createCommentsOutbox({ store, environment: tab(true) }))
  await vi.waitFor(() => assert.equal(fetches.length, 1), { timeout: 5_000 })
  await vi.waitFor(() => assert.ok(pageRefreshes.includes("comments:doc")), { timeout: 5_000 })
})

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

test("a waiting image keeps its address when the outbox reads its entry again", () => {
  const revoked = []
  let made = 0
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:local/${++made}`)
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => void revoked.push(url))
  const urls = fileUrls()
  // IndexedDB gives back a new Blob of the same image after each try.
  assert.equal(urls.urlOf("e1:0", new Blob(["png"])), "blob:local/1")
  urls.keep(["e1:0"])
  assert.equal(urls.urlOf("e1:0", new Blob(["png"])), "blob:local/1")
  assert.deepEqual(revoked, [])
  urls.keep([])
  assert.deepEqual(revoked, ["blob:local/1"])
  vi.restoreAllMocks()
})
