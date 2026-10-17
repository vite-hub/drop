<script setup lang="ts">
// What changed between this version and another: a line diff of the source for Markdown and HTML docs, the two
// images side by side, or just the two files for anything else. Older on the left (or above), newer after.
import { diffHunks, diffLines } from "#shared/line-diff"
import type { DropDetail, DropVersion } from "#shared/types"

const props = defineProps<{ drop: DropDetail; other: DropVersion }>()
const open = defineModel<boolean>("open", { default: false })

const fetched = useApi<DropDetail>(() => `/api/drops/${props.other.id}`, { key: () => `drop:${props.other.id}`, lazy: true, server: false })
const pair = computed(() => {
  const other = fetched.data.value
  if (!other) return null
  return other.version < props.drop.version ? { before: other, after: props.drop } : { before: props.drop, after: other }
})
const text = computed(() => pair.value && pair.value.before.content !== undefined && pair.value.after.content !== undefined)
const hunks = computed(() => (text.value ? diffHunks(diffLines(pair.value!.before.content!, pair.value!.after.content!)) : []))
const counts = computed(() => ({ add: hunks.value.filter(line => line.type === "add").length, remove: hunks.value.filter(line => line.type === "remove").length }))
const title = computed(() => (pair.value ? `v${pair.value.before.version} → v${pair.value.after.version}` : "Compare versions"))
</script>

<template>
  <UModal v-model:open="open" :description="drop.title" fullscreen :title="title">
    <template #body>
      <div v-if="fetched.error.value" class="py-10 text-center text-sm text-muted">{{ errorText(fetched.error.value, "Couldn't open that version.") }}</div>
      <div v-else-if="!pair" class="py-10 text-center text-sm text-muted">Loading v{{ other.version }}…</div>

      <div v-else-if="text" class="mx-auto max-w-4xl">
        <p class="mb-3 font-mono text-xs text-muted">
          <span class="text-success">+{{ counts.add }}</span> <span class="text-error">−{{ counts.remove }}</span>
          <span v-if="pair.after.note"> · {{ pair.after.note }}</span>
        </p>
        <p v-if="!counts.add && !counts.remove" class="py-10 text-center text-sm text-muted">The source is the same.</p>
        <div v-else class="overflow-x-auto rounded-md border border-default font-mono text-xs leading-5">
          <template v-for="(line, index) in hunks" :key="index">
            <div v-if="line.type === 'gap'" class="border-y border-default bg-elevated px-3 py-1 text-dimmed">{{ line.lines }} unchanged {{ line.lines === 1 ? "line" : "lines" }}</div>
            <div
              v-else
              class="px-3 whitespace-pre"
              :class="{ 'bg-success/10 text-highlighted': line.type === 'add', 'bg-error/10 text-muted line-through decoration-error/40': line.type === 'remove' }"
            ><span class="mr-3 inline-block w-3 text-dimmed select-none">{{ line.type === "add" ? "+" : line.type === "remove" ? "−" : "" }}</span>{{ line.text || " " }}</div>
          </template>
        </div>
      </div>

      <div v-else-if="pair.before.kind === 'image' && pair.after.kind === 'image'" class="grid gap-4 md:grid-cols-2">
        <figure v-for="side in [pair.before, pair.after]" :key="side.id" class="space-y-2">
          <figcaption class="label-mono">v{{ side.version }}</figcaption>
          <img :alt="`v${side.version}`" class="w-full rounded-md border border-default" :src="side.url">
        </figure>
      </div>

      <!-- TODO(diff): PDFs and other files have no preview to compare yet, so this only names the two files. -->
      <ul v-else class="mx-auto max-w-md space-y-2 py-6 text-sm">
        <li v-for="side in [pair.before, pair.after]" :key="side.id" class="flex items-center gap-3">
          <span class="label-mono w-8">v{{ side.version }}</span>
          <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ side.filename }}</span>
          <span class="text-muted tabular-nums">{{ formatBytes(side.size) }}</span>
          <UButton v-if="side.url" color="neutral" icon="i-lucide-download" size="xs" :to="side.url" external target="_blank" variant="ghost" />
        </li>
      </ul>
    </template>
  </UModal>
</template>
