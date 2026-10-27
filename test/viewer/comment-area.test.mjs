import assert from "node:assert/strict"
import { afterEach, test, vi } from "vite-plus/test"
import {
  computed,
  createRenderer,
  effectScope,
  h,
  nextTick,
  onScopeDispose,
  reactive,
  ref,
  shallowRef,
  watch,
} from "vue"
import { createInjectionState, useFileDialog } from "@vueuse/core"
import { useViewerAnnotations } from "../../app/composables/useViewerAnnotations.ts"
import { useImagePicks } from "../../app/composables/useImagePicks.ts"

for (const [name, value] of Object.entries({
  computed,
  reactive,
  ref,
  shallowRef,
  watch,
  onScopeDispose,
  createInjectionState,
  useFileDialog,
  useImagePicks,
}))
  vi.stubGlobal(name, value)
const { provideReviewDraft, injectReviewDraft } = await import("../../app/composables/useReviewDraft.ts")
const scopes = []
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()))
function viewer(kind = "markdown") {
  const scope = effectScope()
  scopes.push(scope)
  const options = {
    drop: ref({ kind, canComment: true }),
    editing: ref(false),
    enabled: ref(true),
    reviewOpen: ref(false),
  }
  return { ...options, ...scope.run(() => useViewerAnnotations(options)) }
}
const frame = { left: 0, top: 0, scale: 1 }
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

test("text and attached images survive plain/area composer replacement, then release on leaving the viewer", async () => {
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
  const Composer = {
    setup() {
      composer = injectReviewDraft()
      return () => h("div")
    },
  }
  const app = renderer.createApp({
    setup() {
      draft = provideReviewDraft()
      return () => h(Composer, { key: mode.value })
    },
  })
  app.mount(node())
  const image = new File(["image"], "feedback.png", { type: "image/png" })
  draft.body.value = "Keep this feedback"
  draft.images.drop({ dataTransfer: { files: [image] }, preventDefault() {} })
  const preview = draft.images.picks.value[0].url
  for (const next of ["area", "plain"]) {
    mode.value = next
    await nextTick()
    assert.equal(composer.body.value, "Keep this feedback")
    assert.deepEqual(composer.images.files.value, [image])
    assert.equal((await fetch(preview)).status, 200)
  }
  const finish = composer.beginSend()
  mode.value = "area"
  await nextTick()
  assert.equal(composer.sending.value, true)
  assert.equal(composer.beginSend(), undefined)
  composer.body.value = "New feedback while uploading"
  const secondImage = new File(["second"], "second.png", { type: "image/png" })
  composer.images.drop({ dataTransfer: { files: [secondImage] }, preventDefault() {} })
  const secondPreview = composer.images.picks.value[1].url
  assert.equal(finish(true), false)
  assert.equal(composer.body.value, "New feedback while uploading")
  assert.deepEqual(composer.images.files.value, [image, secondImage])
  assert.equal((await fetch(secondPreview)).status, 200)

  // Failure retains the draft; a stale completion cannot release a later request.
  const failed = composer.beginSend()
  assert.equal(failed(false), false)
  const accepted = composer.beginSend()
  finish(true)
  assert.equal(composer.sending.value, true)
  assert.equal(accepted(true), true)
  assert.equal(composer.body.value, "")
  assert.deepEqual(composer.images.files.value, [])
  await assert.rejects(fetch(preview))
  await assert.rejects(fetch(secondPreview))

  // Editing back to the submitted text still constitutes a newer draft.
  composer.body.value = "Original"
  const edited = composer.beginSend()
  composer.body.value = "Edited"
  composer.body.value = "Original"
  assert.equal(edited(true), false)
  assert.equal(composer.body.value, "Original")
  app.unmount()
})
