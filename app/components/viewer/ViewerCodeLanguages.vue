<script setup lang="ts">
// A language select in the top right of each code block in the live editor, as in Linear. It sits over the editor,
// not inside it, so ProseMirror's DOM stays plain; the block's `language` attribute syncs through the room like any edit.
import type { Editor } from "@tiptap/vue-3"
import { CODE_LANGUAGE_LABELS, type CodeLanguage, codeLanguage } from "#shared/highlighter"

const props = defineProps<{ editor: Editor }>()

const items = [
  // Reka's items can't use "" as a value, so plain text is "text", saved as no language.
  { label: "Plain text", value: "text" },
  ...Object.entries(CODE_LANGUAGE_LABELS)
    .map(([value, label]) => ({ label, value }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]

interface Block {
  /** Stays with its code block while blocks are added or removed above it, so an open select stays on its block. */
  id: number
  element: HTMLElement
  top: number
  right: number
  language?: CodeLanguage
  // A fence's language Drop doesn't highlight still shows, as written.
  written?: string
}

const blocks = shallowRef<Block[]>([])
// ProseMirror keeps a code block's DOM node across edits, so the node names the block.
const ids = new WeakMap<HTMLElement, number>()
let lastId = 0
function idOf(element: HTMLElement) {
  let id = ids.get(element)
  if (id === undefined) ids.set(element, (id = ++lastId))
  return id
}
// The selects are placed against this layer, which covers the same box as the editor's column.
const layer = useTemplateRef("layer")

function measure() {
  const { view } = props.editor
  const box = layer.value?.getBoundingClientRect()
  if (!box) return
  const next: Block[] = []
  props.editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return
    const element = view.nodeDOM(pos)
    if (element instanceof HTMLElement) {
      const rect = element.getBoundingClientRect()
      const info = textValue(node.attrs.language)?.trim() ?? ""
      next.push({
        id: idOf(element),
        element,
        top: rect.top - box.top,
        right: box.right - rect.right,
        language: codeLanguage(info),
        written: info.split(/\s/, 1)[0] || undefined,
      })
    }
    return false
  })
  blocks.value = next
}

// The block's position comes from its DOM at the moment of choosing, since teammates' edits move it.
function choose(block: Block, value: string) {
  const { view } = props.editor
  const pos = view.posAtDOM(block.element, 0) - 1
  if (view.state.doc.nodeAt(pos)?.type.name !== "codeBlock") return
  props.editor
    .chain()
    .command(({ tr }) => {
      tr.setNodeAttribute(pos, "language", value === "text" ? null : value)
      return true
    })
    .run()
}

onMounted(() => {
  measure()
  props.editor.on("update", measure)
})
onBeforeUnmount(() => props.editor.off("update", measure))
// Wrapping, images loading, and the window resizing move blocks without an edit.
useResizeObserver(
  () => props.editor.view.dom,
  () => measure(),
)
</script>

<template>
  <div ref="layer" class="pointer-events-none absolute inset-0 z-10">
    <USelectMenu
      v-for="block in blocks"
      :key="block.id"
      :model-value="block.language ?? (block.written ? undefined : 'text')"
      :items="items"
      value-key="value"
      :placeholder="block.written ?? 'Plain text'"
      :search-input="{ placeholder: 'Search languages' }"
      :content="{ align: 'end' }"
      :ui="{ content: 'min-w-44' }"
      size="xs"
      variant="ghost"
      trailing-icon="i-mingcute-down-line"
      aria-label="Code language"
      class="pointer-events-auto absolute w-auto text-muted hover:text-default"
      :style="{ top: `${block.top + 4}px`, right: `${block.right + 4}px` }"
      @update:model-value="(value: string) => choose(block, value)"
    />
  </div>
</template>
