import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { computed, reactive, ref } from "vue"
import { transpileModule } from "typescript"
import { test } from "vite-plus/test"

const source = readFileSync(new URL("../../app/components/DropViewer.vue", import.meta.url), "utf8")
const eligibility = source.slice(source.indexOf("const onPage ="), source.indexOf("// Whether the Comments list"))
const pdfPins = source.slice(source.indexOf("const pdfComments ="), source.indexOf("/** A PDF's page, still"))

test("PDF pins respect resolved threads and hidden-comment exceptions", () => {
  const open = { id: "open", kind: "image", pdfPage: 1, resolved: false }
  const resolved = { id: "resolved", kind: "image", pdfPage: 2, resolved: true }
  const state = new Function(
    "computed",
    "ref",
    "reactive",
    `
    const pageComments = ref(${JSON.stringify([open, resolved])})
    const pdf = ref(true), popover = ref(null), overlays = reactive({ pins: true })
    const shownWhileHidden = ref([]), replaced = () => false
    ${transpileModule(eligibility, {}).outputText}
    ${pdfPins}
    return { pdfComments, popover, overlays, shownWhileHidden }
  `,
  )(computed, ref, reactive)
  assert.deepEqual(
    state.pdfComments.value.map((c) => c.id),
    ["open"],
  )
  state.popover.value = { type: "thread", id: "resolved" }
  assert.deepEqual(
    state.pdfComments.value.map((c) => c.id),
    ["open", "resolved"],
  )
  state.overlays.pins = false
  assert.deepEqual(state.pdfComments.value, [])
  state.shownWhileHidden.value = ["resolved"]
  assert.deepEqual(
    state.pdfComments.value.map((c) => c.id),
    ["resolved"],
  )
  state.popover.value = null
  assert.deepEqual(state.pdfComments.value, [])
  state.shownWhileHidden.value = ["open"]
  assert.deepEqual(
    state.pdfComments.value.map((c) => c.id),
    ["open"],
  )
})
