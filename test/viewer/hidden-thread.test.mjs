import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { computed, effectScope, nextTick, onScopeDispose, reactive, ref, shallowRef, watch } from "vue"
import { createCommentVisibility } from "vite-hub/ui"
import { test, vi } from "vite-plus/test"
import { transpileModule } from "typescript"

// Execute the actual viewer handlers with Vue's reactive state, without Nuxt services.
const source = readFileSync(new URL("../../app/components/DropViewer.vue", import.meta.url), "utf8")
const close = source.match(/function closeComments\(\) \{[\s\S]*?\n\}/)[0]
const show = source.match(/function showComments\(\) \{[\s\S]*?\n\}/)[0]
const toggleArea = source.match(/function toggleCommentArea\(\) \{[\s\S]*?\n\}/)[0]
const annotationSource = readFileSync(new URL("../../app/composables/useViewerAnnotations.ts", import.meta.url), "utf8")
const select = annotationSource.match(/function commentOnSelection\(suggest = false\) \{[\s\S]*?\n  \}/)[0]
const shown = transpileModule(
  source.match(/const visibility = createCommentVisibility\([\s\S]*?\nconst showSent = .*\n/)[0],
  {},
).outputText
const build = new Function(
  "ref",
  "reactive",
  "computed",
  "shallowRef",
  "watch",
  "onScopeDispose",
  "createCommentVisibility",
  `
  const commentsOpen = ref(true), popover = ref({ type: 'thread', id: 'area' })
  const overlays = reactive({ pins: false }), tool = ref('comment'), selection = ref(null)
  const annotations = { beginFocus() {} }, reviewDock = ref(null)
  const hasComments = ref(true), editing = ref(false), shareOpen = ref(false), detailsPop = ref(null)
  const canMarkArea = ref(true), canUseCommentMode = ref(false), trashed = ref(false), commentMode = ref(false)
  ${close}
  ${show}
  ${toggleArea}
  ${select}
  ${shown}
  return { commentsOpen, popover, showSent, overlays, shownWhileHidden, closeComments, showComments, selection, commentOnSelection, toggleCommentArea }
`,
)
const setup = () =>
  effectScope().run(() => build(ref, reactive, computed, shallowRef, watch, onScopeDispose, createCommentVisibility))

test("the live-site area shortcut reports success only when it opens comments", () => {
  const state = setup()
  state.closeComments()
  assert.equal(state.toggleCommentArea(), true)
  assert.equal(state.commentsOpen.value, true)
  assert.ok(!state.toggleCommentArea())
  state.closeComments()
  assert.equal(state.toggleCommentArea(), true)
})

test("closing comments ends a thread reveal without changing the eye or a sent comment's exception", async () => {
  vi.useFakeTimers()
  try {
    const state = setup()
    assert.deepEqual(state.shownWhileHidden.value, ["area"])
    state.showSent("just-sent")
    state.closeComments()
    await nextTick()
    assert.equal(state.commentsOpen.value, false)
    assert.equal(state.popover.value, null)
    assert.equal(state.overlays.pins, false)
    assert.deepEqual(state.shownWhileHidden.value, ["just-sent"])
    state.commentsOpen.value = true
    await nextTick()
    assert.equal(state.popover.value, null)
    // ViteHub's model keeps a comment just sent for 2.5 s, then lets it go.
    vi.advanceTimersByTime(2500)
    assert.deepEqual(state.shownWhileHidden.value, [])
  } finally {
    vi.useRealTimers()
  }
})

test("a retained popover cannot reveal a thread while the dock is dismissed", async () => {
  const state = setup()
  state.commentsOpen.value = false
  await nextTick()
  assert.deepEqual(state.shownWhileHidden.value, [])
})

test("collapsing and reopening comments retains the pending anchor and edited suggestion", () => {
  const state = setup()
  state.selection.value = {
    selector: "main > article > p",
    quote: "twelve pigeons",
    label: "p",
    rect: { left: 20, bottom: 100 },
  }
  state.commentOnSelection(true)
  const pending = state.popover.value.pending
  pending.suggestion = "sixteen pigeons"
  state.closeComments()
  assert.equal(state.commentsOpen.value, false)
  assert.equal(state.overlays.pins, false)
  state.showComments()
  assert.equal(state.popover.value.type, "new")
  assert.equal(state.popover.value.pending, pending)
  assert.equal(state.popover.value.pending.suggestion, "sixteen pigeons")
  assert.equal(state.popover.value.pending.selector, "main > article > p")
  assert.equal(state.popover.value.pending.quote, "twelve pigeons")
})
