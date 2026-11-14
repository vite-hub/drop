import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { computed, reactive, ref } from "vue"
import { test } from "vite-plus/test"

// Execute the actual viewer handlers with Vue's reactive state, without Nuxt services.
const source = readFileSync(new URL("../../app/components/DropViewer.vue", import.meta.url), "utf8")
const close = source.match(/function closeComments\(\) \{[\s\S]*?\n\}/)[0]
const shown = source.match(/const shownWhileHidden = computed\([\s\S]*?\n\)/)[0]
const setup = new Function(
  "ref",
  "reactive",
  "computed",
  `
  const commentsOpen = ref(true), popover = ref({ type: 'thread', id: 'area' }), sentShown = ref([])
  const overlays = reactive({ pins: false }), tool = ref('comment'), selection = ref(null)
  const annotations = { beginFocus() {} }, reviewDock = ref(null)
  ${close}
  ${shown}
  return { commentsOpen, popover, sentShown, overlays, shownWhileHidden, closeComments }
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
