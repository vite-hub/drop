import assert from "node:assert/strict"
import { afterEach, test, vi } from "vite-plus/test"
import { computed, effectScope, readonly, ref, shallowRef, toValue, watch } from "vue"
import { createEventHook, createInjectionState } from "@vueuse/core"
import { keys } from "../../app/utils/keys.ts"
import { toThread } from "../../app/utils/comment-threads.ts"

// useDrop's sends go through ViteHub's outbox: they return at once, show as waiting, and reach Drop's routes once.
const fetches = []
let answer
for (const [name, value] of Object.entries({
  computed,
  readonly,
  ref,
  shallowRef,
  toValue,
  watch,
  createEventHook,
  createInjectionState,
  keys,
  toThread,
  useApi: (_url, options) => ({ data: ref(options.default?.()), refresh: async () => {} }),
  useMe: () => ({ data: ref({ id: "ada", name: "Ada", image: null }) }),
  useNotify: () => ({ problem: () => "problem", alert() {}, fail() {} }),
  refreshNuxtData: async () => {},
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
const { provideDrop } = await import("../../app/composables/useDrop.ts")

const scopes = []
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop())
  fetches.length = 0
})
function open(id = "doc") {
  const scope = effectScope()
  scopes.push(scope)
  const state = scope.run(() => provideDrop(id))
  const wrote = vi.fn()
  state.onWrote(wrote)
  return { state, wrote }
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
