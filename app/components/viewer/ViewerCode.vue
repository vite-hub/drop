<script setup lang="ts">
// Line-numbered source with a slim path bar. Editable while editing.
const props = withDefaults(defineProps<{ path: string; source: string; editable?: boolean }>(), { editable: false })
const emit = defineEmits<{ change: [value: string] }>()
const lines = computed(() => props.source.split("\n").length)
const { copy, copied } = useCopy()

function tab(event: KeyboardEvent) {
  const target = event.target as HTMLTextAreaElement
  const { selectionStart, selectionEnd } = target
  emit("change", props.source.slice(0, selectionStart) + "  " + props.source.slice(selectionEnd))
  requestAnimationFrame(() => target.setSelectionRange(selectionStart + 2, selectionStart + 2))
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-9 shrink-0 items-center gap-2 border-b border-default pr-1 pl-3">
      <span class="truncate font-mono text-xs">{{ path }}</span>
      <span class="font-mono text-[11px] whitespace-nowrap text-muted">{{ lines }} lines · {{ formatBytes(source.length) }}</span>
      <span class="ml-auto flex items-center gap-0.5">
        <slot name="actions" />
        <UButton aria-label="Copy file" color="neutral" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" size="sm" variant="ghost" @click="copy(source)" />
      </span>
    </div>
    <div class="flex min-h-0 flex-1 overflow-auto font-mono text-[12.5px] leading-6">
      <div aria-hidden="true" class="sticky left-0 shrink-0 border-r border-default bg-default px-2.5 py-3 text-right text-dimmed select-none">
        <div v-for="index in lines" :key="index">{{ index }}</div>
      </div>
      <textarea
        v-if="editable"
        :aria-label="`Edit ${path}`"
        class="min-h-full flex-1 resize-none bg-default px-3 py-3 whitespace-pre text-highlighted outline-none [tab-size:2]"
        spellcheck="false"
        :value="source"
        wrap="off"
        @input="event => emit('change', (event.target as HTMLTextAreaElement).value)"
        @keydown.tab.prevent="tab"
      />
      <pre v-else class="flex-1 bg-default px-3 py-3 [tab-size:2]"><code>{{ source }}</code></pre>
    </div>
  </div>
</template>
