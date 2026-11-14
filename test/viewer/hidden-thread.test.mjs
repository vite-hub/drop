import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { computed, reactive, ref } from "vue"
import { test } from "vite-plus/test"

// Execute the actual viewer handlers with Vue's reactive state, without Nuxt services.
const source = readFileSync(new URL("../../app/components/DropViewer.vue", import.meta.url), "utf8")
const close = source.match(/function closeComments\(\) \{[\s\S]*?\n\}/)[0]
const show = source.match(/function showComments\(\) \{[\s\S]*?\n\}/)[0]
const annotationSource = readFileSync(new URL("../../app/composables/useViewerAnnotations.ts", import.meta.url), "utf8")
const select = annotationSource.match(/function commentOnSelection\(suggest = false\) \{[\s\S]*?\n  \}/)[0]
const shown = source.match(/const shownWhileHidden = computed\([\s\S]*?\n\)/)[0]
const setup = new Function(
  "ref",
  "reactive",
  "computed",
  `
  const commentsOpen = ref(true), popover = ref({ type: 'thread', id: 'area' }), sentShown = ref([])
  const overlays = reactive({ pins: false }), tool = ref('comment'), selection = ref(null)
  const annotations = { beginFocus() {} }, reviewDock = ref(null)
  const hasComments = ref(true), editing = ref(false), shareOpen = ref(false), detailsPop = ref(null)
  ${close}
  ${show}
  ${select}
  ${shown}
  return { commentsOpen, popover, sentShown, overlays, shownWhileHidden, closeComments, showComments, selection, commentOnSelection }
`,
)

test("closing comments ends a thread reveal without changing the eye or a sent comment's exception", () => {
  const state = setup(ref, reactive, computed)
  assert.deepEqual(state.shownWhileHidden.value, ["area"])
  state.sentShown.value = ["just-sent"]
  state.closeComments()
  assert.equal(state.commentsOpen.value, false)
  assert.equal(state.popover.value, null)
  assert.equal(state.overlays.pins, false)
  assert.deepEqual(state.shownWhileHidden.value, ["just-sent"])
  state.commentsOpen.value = true
  assert.equal(state.popover.value, null)
  state.sentShown.value = []
  assert.deepEqual(state.shownWhileHidden.value, [])
})

test("a retained popover cannot reveal a thread while the dock is dismissed", () => {
  const state = setup(ref, reactive, computed)
  state.commentsOpen.value = false
  assert.deepEqual(state.shownWhileHidden.value, [])
})

test("collapsing and reopening comments retains the pending anchor and edited suggestion", () => {
  const state = setup(ref, reactive, computed)
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
