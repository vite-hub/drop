import assert from "node:assert/strict"
import { afterEach, beforeEach, test, vi } from "vite-plus/test"
import { computed, effectScope, onScopeDispose, readonly, ref, shallowRef, toValue, watch } from "vue"
import { createMemoryOutboxStore } from "vite-hub/comments/client"
import { createEventHook, createInjectionState, useEventListener, useTimeoutFn } from "@vueuse/core"
import { keys } from "../../app/utils/keys.ts"
import { deliveryLine } from "../../app/utils/comment-delivery.ts"
import { toThread } from "../../app/utils/comment-threads.ts"

// Send on a new comment's composer (usePinSend) over the app's real outbox and useDrop, with Nuxt's auto-imports
// stubbed as in comment-outbox.test.mjs. The store and the screenshot can be held, to look at the page in between.
const fetches = []
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
  useOnline: () => ref(true),
  keys,
  toThread,
  useApi: (_url, options) => ({ data: ref(options.default?.()), refresh: async () => {} }),
  reportClientError: () => {},
  useMe: () => ({ data: ref({ id: "ada", name: "Ada", image: null }), status: ref("success") }),
  useNotify: () => ({ problem: (error) => error.message, alert() {}, fail() {} }),
  useCommentsOutbox: () => app,
  refreshNuxtData: async () => {},
  quotaFailureOf: () => undefined,
  $fetch: async (url, options) => {
    const form = options.body instanceof FormData ? options.body : undefined
    const body = form ? JSON.parse(form.get("data")) : options.body
    fetches.push({ url, body: body.body, images: form ? form.getAll("image").map((file) => file.name) : [] })
    return { ...comment(`c${fetches.length}`, body.body), requestId: body.requestId, n: fetches.length }
  },
}))
  vi.stubGlobal(name, value)
const outboxUtils = await import("../../app/utils/comment-outbox.ts")
for (const [name, value] of Object.entries(outboxUtils)) vi.stubGlobal(name, value)
vi.stubGlobal("window", new EventTarget())
vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }))
const { createCommentsOutbox } = await import("../../app/composables/useCommentsOutbox.ts")
const { provideDrop } = await import("../../app/composables/useDrop.ts")
const { usePinSend } = await import("../../app/composables/usePinSend.ts")

const comment = (id, body) => ({
  id,
  messageId: `${id}-m`,
  body,
  kind: "area",
  selector: "#chart",
  ox: 10,
  oy: 20,
  ow: 100,
  oh: 200,
  label: "Chart",
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

// A durable store whose writes can wait, or fail as a full or blocked IndexedDB does.
function heldStore() {
  const memory = createMemoryOutboxStore()
  let gate
  let readGate
  let refusing = false
  return {
    persisted: true,
    async list(account) {
      await readGate?.promise
      return memory.list(account)
    },
    saved: () => memory.list("ada"),
    async update(account, change) {
      if (refusing) throw new Error("The browser didn't save it.")
      await gate?.promise
      return memory.update(account, change)
    },
    hold: () => void (gate = Promise.withResolvers()),
    release: () => gate?.resolve((gate = undefined)),
    holdReads: () => void (readGate = Promise.withResolvers()),
    releaseReads: () => readGate?.resolve((readGate = undefined)),
    refuse: (value) => void (refusing = value),
  }
}

// One screenshot per area, settled by the test.
function shots() {
  const taken = new Map()
  let last = 0
  return {
    take: () => (taken.set(++last, Promise.withResolvers()), last),
    arrive: (id, file) => taken.get(id).resolve(file),
    shotFor: (id) => taken.get(id)?.promise ?? Promise.resolve(null),
  }
}

let app
let store
let scope
beforeEach(async () => {
  store = heldStore()
  scope = effectScope()
  app = scope.run(() => createCommentsOutbox({ store }))
  await vi.waitFor(() => assert.ok(app.ready()))
})
afterEach(() => {
  store.release()
  store.releaseReads()
  scope.stop()
  fetches.length = 0
})

function viewer() {
  const state = scope.run(() => provideDrop("doc"))
  state.drop.data.value = { kind: "markdown", version: 1 }
  const popover = ref(null)
  const picks = ref([])
  const body = ref("")
  const draft = {
    body,
    mentions: ref([]),
    images: { files: picks, add: (files) => (picks.value = [...picks.value, ...files]) },
    scope: ref("doc"),
    clear: () => {
      body.value = ""
      picks.value = []
    },
  }
  const shot = shots()
  const events = { closed: 0, sent: [], failed: [] }
  const { submit } = usePinSend({
    popover,
    draft,
    page: () => undefined,
    shown: () => null,
    shotFor: shot.shotFor,
    ready: () => Boolean(app.ready()),
    prepare: () => app.writable(),
    addComment: state.addComment,
    closed: () => events.closed++,
    sent: (id) => events.sent.push(id),
    fail: (reason) => events.failed.push(reason),
  })
  const area = (label) => {
    popover.value = {
      type: "new",
      x: 0,
      y: 0,
      pending: { kind: "area", selector: "#chart", ox: 10, oy: 20, ow: 100, oh: 200, label },
      shot: shot.take(),
    }
  }
  const write = (text, files = []) => {
    body.value = text
    draft.mentions.value = ["bea"]
    picks.value = files
    return submit(text, files, ["bea"])
  }
  return { state, popover, draft, picks, shot, events, area, write }
}

const waiting = (state) => state.list.value.map((item) => [item.body, item.delivery?.status])

test("Send empties and closes the composer and lists the comment while its save and screenshot wait", async () => {
  const page = viewer()
  store.hold()
  page.area("Chart")
  void page.write("The chart is cut off", [new File(["a"], "picked.png", { type: "image/png" })])

  assert.equal(page.popover.value, null)
  assert.equal(page.draft.body.value, "")
  assert.deepEqual(page.draft.mentions.value, [])
  assert.deepEqual(page.picks.value, [])
  assert.equal(page.events.closed, 1)
  assert.deepEqual(waiting(page.state), [["The chart is cut off", "pending"]])
  assert.equal(fetches.length, 0)

  // The next comment starts at once, while the first still waits for its store and its screenshot.
  page.area("Legend")
  void page.write("The legend overlaps")
  assert.deepEqual(waiting(page.state), [
    ["The chart is cut off", "pending"],
    ["The legend overlaps", "pending"],
  ])
  assert.equal(page.state.list.value[1].requestId === page.state.list.value[0].requestId, false)

  // The second area's screenshot never comes; the first one's comes late.
  page.shot.arrive(2, null)
  store.release()
  await vi.waitFor(async () => {
    const [first] = await store.saved()
    assert.equal(first?.awaitingFiles, true)
    assert.deepEqual(
      first.files.map((file) => file.name),
      ["picked.png"],
    )
  })
  assert.equal(fetches.length, 0, "the first comment waits for its screenshot, and the second waits behind it")
  page.shot.arrive(1, new File(["shot"], "screenshot.png", { type: "image/png" }))

  await vi.waitFor(() => assert.equal(fetches.length, 2))
  assert.deepEqual(fetches, [
    { url: "/api/drops/doc/comments", body: "The chart is cut off", images: ["picked.png", "screenshot.png"] },
    { url: "/api/drops/doc/comments", body: "The legend overlaps", images: [] },
  ])
  await vi.waitFor(() => assert.equal(app.entries.value.length, 0))
  assert.equal(page.events.sent.length, 2)
  assert.deepEqual(page.events.failed, [])
})

test("a comment the browser refuses to save shows as failed with its text, and Retry sends it", async () => {
  const page = viewer()
  store.refuse(true)
  page.area("Chart")
  void page.write("Keep me")
  assert.equal(page.popover.value, null)

  await vi.waitFor(() => assert.deepEqual(waiting(page.state), [["Keep me", "failed"]]))
  const [failed] = page.state.list.value
  assert.equal(failed.delivery.error?.why, "The browser didn't save it.")
  assert.equal(page.popover.value, null, "no composer is left open")
  assert.deepEqual(page.events.failed, [])

  store.refuse(false)
  page.shot.arrive(1, null)
  await app.retry(failed.id)
  await vi.waitFor(() => assert.equal(fetches.length, 1))
  assert.equal(fetches[0].body, "Keep me")
  await vi.waitFor(() => assert.equal(app.entries.value.length, 0))
})

test("leaving the page asks first while a sent comment is still being saved", async () => {
  const page = viewer()
  store.hold()
  page.area("Chart")
  void page.write("Not yet saved")
  const leave = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(leave)
  assert.equal(leave.defaultPrevented, true)
})

test("before the outbox is ready, Send waits with the composer open and shows why it can't keep the comment", async () => {
  const page = viewer()
  store.persisted = false
  page.area("Chart")
  await page.write("Private window")
  assert.equal(page.popover.value?.type, "new")
  assert.equal(page.draft.body.value, "Private window")
  assert.deepEqual(page.events.failed, ["Allow browser storage before sending comments. Your draft is still here."])
  assert.deepEqual(waiting(page.state), [])
})

test("editing the same composer during storage preparation preserves the newer draft", async () => {
  const page = viewer()
  store.persisted = false
  store.holdReads()
  page.area("Chart")
  const submitted = page.write("Original text")
  assert.equal(page.popover.value?.type, "new")
  page.draft.body.value = "Corrected text"
  const picked = new File(["picked"], "correction.png", { type: "image/png" })
  page.picks.value = [picked]
  page.draft.mentions.value = ["cal"]
  store.persisted = true
  store.releaseReads()
  await submitted

  assert.equal(page.popover.value?.type, "new")
  assert.equal(page.draft.body.value, "Corrected text")
  assert.deepEqual(page.picks.value, [picked])
  assert.deepEqual(page.draft.mentions.value, ["cal"])
  assert.deepEqual(waiting(page.state), [])
})

test("Send again recovers a refused deferred attachment write", async () => {
  const page = viewer()
  const picked = new File(["picked"], "picked.png", { type: "image/png" })
  page.area("Chart")
  await page.write("Keep both files", [picked])
  await vi.waitFor(async () => assert.equal((await store.saved())[0]?.awaitingFiles, true))
  store.refuse(true)
  page.shot.arrive(1, new File(["shot"], "screenshot.png", { type: "image/png" }))
  await vi.waitFor(() => assert.deepEqual(waiting(page.state), [["Keep both files", "failed"]]))

  const [failed] = page.state.list.value
  assert.equal(fetches.length, 0)
  assert.deepEqual(deliveryLine(failed.delivery, failed.createdAt, Date.now())?.actions, ["retry", "discard"])
  store.refuse(false)
  await app.retry(failed.id)
  await vi.waitFor(() =>
    assert.deepEqual(fetches, [
      { url: "/api/drops/doc/comments", body: "Keep both files", images: ["picked.png", "screenshot.png"] },
    ]),
  )
  await vi.waitFor(() => assert.equal(app.entries.value.length, 0))
})
