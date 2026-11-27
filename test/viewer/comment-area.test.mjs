import assert from "node:assert/strict"
import { afterEach, test, vi } from "vite-plus/test"
import {
  computed,
  createRenderer,
  effectScope,
  h,
  nextTick,
  onMounted,
  onScopeDispose,
  reactive,
  ref,
  shallowRef,
  watch,
} from "vue"
import { createInjectionState, useFileDialog } from "@vueuse/core"
import { useViewerAnnotations } from "../../app/composables/useViewerAnnotations.ts"
import { useViewerFrame } from "../../app/composables/useViewerFrame.ts"
import { useImagePicks } from "../../app/composables/useImagePicks.ts"
import { MARK_COLORS, MARK_TIPS } from "../../shared/utils/marker.ts"

for (const [name, value] of Object.entries({
  computed,
  reactive,
  ref,
  shallowRef,
  watch,
  onMounted,
  onScopeDispose,
  createInjectionState,
  useFileDialog,
  useImagePicks,
  MARK_COLORS,
  MARK_TIPS,
}))
  vi.stubGlobal(name, value)
const { provideReviewDraft, injectReviewDraft } = await import("../../app/composables/useReviewDraft.ts")
const scopes = []
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()))
function viewer(kind = "markdown", optionsOverride = {}) {
  const scope = effectScope()
  scopes.push(scope)
  const shots = []
  const options = {
    drop: ref({ kind, canComment: true }),
    editing: ref(false),
    enabled: ref(true),
    reviewOpen: ref(false),
    shot: (file) => shots.push(file),
    shots,
    ...optionsOverride,
  }
  return { ...options, ...scope.run(() => useViewerAnnotations(options)) }
}

test("entering a prototype canvas clears inspection and blocks toolbar and frame shortcuts", () => {
  const canvas = ref(false)
  const pressed = []
  const state = viewer("html", {
    canvas,
    onShortcut: (key, action) => {
      if (action()) pressed.push(key)
    },
  })
  state.setTool("measure")
  state.toggleOverlay("xray")
  assert.equal(state.frameTool.value, "measure")
  assert.equal(state.overlays.xray, true)

  canvas.value = true
  assert.equal(state.frameTool.value, "browse")
  assert.equal(state.overlays.xray, false)

  state.setTool("measure")
  state.toggleOverlay("xray")
  for (const key of ["s", "x"]) state.receive({ type: "key", key }, frame)
  assert.equal(state.frameTool.value, "browse")
  assert.equal(state.overlays.xray, false)
  assert.deepEqual(pressed, [])

  canvas.value = false
  for (const key of ["s", "x"]) state.receive({ type: "key", key }, frame)
  assert.equal(state.frameTool.value, "measure")
  assert.equal(state.overlays.xray, true)
  assert.deepEqual(pressed, ["s", "x"])
})
const frame = { left: 0, top: 0, scale: 1 }

test("a frame Marker retry releases Done and app browse keys do not dispatch shortcuts", () => {
  const pressed = []
  const annotations = viewer("app", {
    onShortcut: (key, action) => {
      if (action()) pressed.push(key)
    },
  })
  let receive
  const globals = {
    useCopy: () => ({ copy: () => {} }),
    useColorMode: () => ref("light"),
    useMounted: () => ref(false),
    useBase64: () => ({ base64: ref("") }),
    useAttachmentData: () => ({}),
    useDebounceFn: (fn) => fn,
    useEventListener: () => {},
    useViewerQuiz: () => ({ receive: () => {} }),
    useDropFrame: (_frame, _origin, handler) => {
      receive = handler
      return { ready: ref(false), send: () => {} }
    },
  }
  for (const [name, value] of Object.entries(globals)) vi.stubGlobal(name, value)
  try {
    scopes.at(-1).run(() =>
      useViewerFrame({
        drop: annotations.drop,
        frame: ref(null),
        app: { files: ref({}), pages: ref([]), page: ref(""), location: ref("/") },
        pinned: ref([]),
        inset: ref(0),
        bottom: ref(0),
        width: ref("readable"),
        annotations,
        toggleZen: () => pressed.push("z"),
      }),
    )
    receive({ type: "key", key: "z", tool: "browse" }, frame)
    receive({ type: "key", key: "b", tool: "browse" }, frame)
    assert.deepEqual(pressed, [])
    assert.equal(annotations.frameTool.value, "browse")
    receive({ type: "key", key: "z", tool: "comment" }, frame)
    receive({ type: "key", key: "b", tool: "comment" }, frame)
    assert.deepEqual(pressed, ["z", "b"])
    assert.equal(annotations.frameTool.value, "mark")
    receive({ type: "marks", count: 1 }, frame)
    annotations.finishing.value = true
    receive({ type: "mark-retry" }, frame)
    assert.equal(annotations.finishing.value, false)
    assert.equal(annotations.frameTool.value, "mark")
    assert.equal(annotations.marks.value, 1)
  } finally {
    for (const name of Object.keys(globals)) vi.stubGlobal(name, undefined)
  }
})

const area = {
  type: "area",
  selector: "body",
  label: "Page",
  ox: 10,
  oy: 20,
  ow: 100,
  oh: 200,
  rect: { left: 10, top: 20, right: 110, bottom: 220 },
}

for (const kind of ["markdown", "html", "app", "image"]) {
  test(`${kind}: Comments permits an optional drag without creating a selection`, () => {
    const state = viewer(kind)
    assert.equal(state.frameTool.value, "browse")
    state.reviewOpen.value = true
    assert.equal(state.frameTool.value, "comment")
    assert.equal(state.popover.value, null)
    state.receive(area, frame)
    assert.equal(state.popover.value.pending.kind, "area")
    assert.equal(state.reviewOpen.value, true)
    assert.equal(state.draftingArea.value, true)
    state.popover.value = null
    assert.equal(state.frameTool.value, "comment")
  })
}

test("closing Comments or pressing Escape restores browsing and keeps an unsent area", () => {
  const state = viewer()
  state.reviewOpen.value = true
  state.receive(area, frame)
  const pending = state.popover.value
  state.reviewOpen.value = false
  assert.equal(state.frameTool.value, "browse")
  assert.equal(state.draftingArea.value, false)
  assert.equal(state.popover.value, pending)
  state.reviewOpen.value = true
  state.receive({ type: "key", key: "Escape", tool: "comment" }, frame)
  assert.equal(state.reviewOpen.value, false)
  assert.equal(state.frameTool.value, "browse")
  assert.equal(state.popover.value, pending)
})

test("R still enables area selection; V gives the page its clicks back", () => {
  const state = viewer()
  state.receive({ type: "key", key: "r", tool: "browse" }, frame)
  assert.equal(state.frameTool.value, "comment")
  state.reviewOpen.value = true
  state.receive({ type: "key", key: "v", tool: "comment" }, frame)
  assert.equal(state.frameTool.value, "browse")
  assert.equal(state.reviewOpen.value, false)
})

test("the Marker: B takes it up, [ and ] size the tip, and its snapshot opens a new comment back under Browse", () => {
  const state = viewer("html")
  state.receive({ type: "key", key: "b", tool: "browse" }, frame)
  assert.equal(state.frameTool.value, "mark")
  assert.deepEqual(state.penStyle.value, { tool: "marker", color: "#ec4899", width: 14 })
  state.receive({ type: "key", key: "a", tool: "mark" }, frame)
  state.receive({ type: "key", key: "]", tool: "mark" }, frame)
  state.receive({ type: "key", key: "]", tool: "mark" }, frame)
  state.receive({ type: "key", key: "]", tool: "mark" }, frame)
  assert.deepEqual(state.penStyle.value, { tool: "arrow", color: "#ec4899", width: 8 })
  state.receive({ type: "marks", count: 2 }, frame)
  assert.equal(state.marks.value, 2)
  state.receive({ ...area, quote: "Not monthly demand.", shot: 1 }, frame)
  assert.equal(state.frameTool.value, "browse")
  assert.equal(state.popover.value.pending.quote, "Not monthly demand.")
  const image = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" })
  state.receive({ type: "area-shot", shot: 1, image }, frame)
  assert.equal(state.shots[0].type, "image/webp")
  // The viewer opens Comments for the new comment, and the strokes stay drawn while it's written.
  state.reviewOpen.value = true
  assert.equal(state.draftingArea.value, true)
})

test("the Marker stays off where areas can't be drawn, and Escape puts it down", () => {
  const state = viewer("board")
  state.receive({ type: "key", key: "b", tool: "browse" }, frame)
  assert.equal(state.frameTool.value, "browse")
  const doc = viewer()
  doc.mark("pen")
  assert.equal(doc.frameTool.value, "mark")
  doc.receive({ type: "key", key: "Escape", tool: "mark" }, frame)
  assert.equal(doc.frameTool.value, "browse")
  // A plain area from the Comment tool takes no quote, whatever the frame sent.
  doc.receive({ ...area, quote: "stray" }, frame)
  assert.equal(doc.popover.value.pending.quote, undefined)
})

test("reading a thread does not let a drag replace a reply", () => {
  const state = viewer()
  state.reviewOpen.value = true
  state.receive({ type: "marker", id: "thread", clientX: 0, clientY: 0 }, frame)
  assert.equal(state.frameTool.value, "browse")
  state.popover.value = null
  assert.equal(state.frameTool.value, "comment")
})

test("area selection respects permissions, edit/diff state, lightboxes, and file capabilities", () => {
  const state = viewer()
  state.reviewOpen.value = true
  for (const gate of [state.editing, state.enabled]) {
    const initial = gate.value
    gate.value = !initial
    assert.equal(state.frameTool.value, "browse")
    gate.value = initial
  }
  state.drop.value.canComment = false
  assert.equal(state.frameTool.value, "browse")
  state.drop.value.canComment = true
  state.lightbox.value = { src: "image.png" }
  assert.equal(state.frameTool.value, "browse")
  state.lightbox.value = null
  for (const kind of ["file", "board", "folder", "site"]) {
    state.drop.value.kind = kind
    assert.equal(state.frameTool.value, "browse")
  }
})

test("text, mentions and attached images survive plain/area composer replacement, then release on leaving the viewer", async () => {
  // A minimal Vue host exercises real provide/inject and component cleanup without a browser.
  const node = () => ({ children: [], parent: null })
  const renderer = createRenderer({
    createElement: node,
    createText: node,
    createComment: node,
    insert(child, parent) {
      child.parent = parent
      parent.children.push(child)
    },
    remove(child) {
      child.parent.children = child.parent.children.filter((item) => item !== child)
    },
    parentNode: (child) => child.parent,
    nextSibling: () => null,
    patchProp() {},
    setText() {},
    setElementText() {},
  })
  const mode = ref("plain")
  let draft, composer
  const author = ref({ id: "ada" })
  const stored = new Map()
  vi.stubGlobal("useMe", () => ({ data: author, status: ref("success") }))
  vi.stubGlobal("localStorage", {
    getItem: (key) => stored.get(key),
    setItem: (key, value) => stored.set(key, value),
    removeItem: (key) => stored.delete(key),
  })
  const Composer = {
    setup() {
      composer = injectReviewDraft()
      return () => h("div")
    },
  }
  const app = renderer.createApp({
    setup() {
      draft = provideReviewDraft(() => "shared-drop")
      return () => h(Composer, { key: mode.value })
    },
  })
  app.mount(node())
  const image = new File(["image"], "feedback.png", { type: "image/png" })
  draft.body.value = "Keep this feedback @Ana Ruiz"
  draft.mentions.value = ["ana"]
  const lookup = draft.rememberPeople([{ id: "ana", name: "Ana Ruiz" }])
  await Promise.resolve()
  assert.deepEqual(draft.people.value, []) // Publication must wait beyond the native input event's microtasks.
  await lookup
  draft.images.drop({ dataTransfer: { files: [image] }, preventDefault() {} })
  const preview = draft.images.picks.value[0].url
  for (const next of ["area", "plain"]) {
    mode.value = next
    await nextTick()
    assert.equal(composer.body.value, "Keep this feedback @Ana Ruiz")
    assert.deepEqual(composer.mentions.value, ["ana"])
    assert.deepEqual(composer.people.value, [{ id: "ana", name: "Ana Ruiz" }])
    assert.deepEqual(composer.images.files.value, [image])
    assert.equal((await fetch(preview)).status, 200)
  }
  // A send empties the draft at once: the comment waits in the outbox, and the next one can start.
  composer.clear()
  assert.equal(draft.body.value, "")
  assert.deepEqual(composer.mentions.value, [])
  assert.deepEqual(composer.people.value, [])
  assert.deepEqual(composer.images.files.value, [])
  await assert.rejects(fetch(preview))
  draft.body.value = "Ada's own draft"
  app.unmount()

  const reload = renderer.createApp({
    setup() {
      draft = provideReviewDraft(() => "shared-drop")
      return () => h("div")
    },
  })
  reload.mount(node())
  assert.equal(draft.body.value, "Ada's own draft")
  author.value = null
  assert.equal(draft.body.value, "")
  draft.body.value = "Guest draft"
  author.value = { id: "bea" }
  assert.equal(draft.body.value, "")
  draft.body.value = "Bea's own draft"
  author.value = { id: "ada" }
  assert.equal(draft.body.value, "Ada's own draft")
  reload.unmount()
})

test("a screenshot that takes a heavy page's 2.5 s after Send still joins its comment", async () => {
  vi.useFakeTimers()
  try {
    const state = viewer("html")
    state.reviewOpen.value = true
    state.receive({ ...area, shot: 1 }, frame)
    const shot = state.shotFor(state.popover.value.shot)
    state.popover.value = null
    await vi.advanceTimersByTimeAsync(2500)
    state.receive({ type: "area-shot", shot: 1, image: new Blob([new Uint8Array([1])], { type: "image/webp" }) }, frame)
    assert.equal((await shot)?.size, 1)
  } finally {
    vi.useRealTimers()
  }
})

test("a screenshot that comes in after the next area started lands on its own comment only", async () => {
  const state = viewer("html")
  state.reviewOpen.value = true
  state.receive({ ...area, shot: 1 }, frame)
  const first = state.popover.value.shot
  const firstShot = state.shotFor(first, 10_000)
  // Send closes the composer before the picture is in, and the reviewer draws the next area at once.
  state.popover.value = null
  state.receive({ ...area, shot: 2 }, frame)
  const second = state.popover.value.shot
  assert.notEqual(second, first)
  const secondShot = state.shotFor(second, 10_000)
  const one = new Blob([new Uint8Array([1])], { type: "image/png" })
  state.receive({ type: "area-shot", shot: 1, image: one }, frame)
  const landed = await firstShot
  assert.ok(landed instanceof File)
  assert.equal(landed.size, 1)
  // The second comment's draft never sees the first picture.
  assert.deepEqual(state.shots, [])
  const two = new Blob([new Uint8Array([2, 2])], { type: "image/webp" })
  state.receive({ type: "area-shot", shot: 2, image: two }, frame)
  assert.equal((await secondShot).size, 2)
  assert.equal(state.shots.length, 1)
  assert.equal(state.shots[0].size, 2)
  // Asked again, a capture answers the same picture; one that never comes in answers null at the cap.
  assert.equal((await state.shotFor(first, 0)).size, 1)
  state.popover.value = null
  state.receive({ ...area, shot: 3 }, frame)
  assert.equal(await state.shotFor(state.popover.value.shot, 5), null)
  assert.equal(await state.shotFor(undefined), null)
})
