<script setup lang="ts">
// What one version changed, against the version before it, shown in place of the document while History stays open
// beside it: a line diff of the source for Markdown and HTML docs, the two images side by side, or just the two files
// for anything else. The first version shows all of itself as added.
import { diffHunks, diffLines } from "#shared/line-diff"
import type { DropDetail, DropVersion } from "#shared/types"

/** `inset`: room to leave on the right for the floating panel, in pixels. */
const props = defineProps<{ version: DropVersion; previous: DropVersion | null; inset: number }>()
const emit = defineEmits<{ close: [] }>()
const versionTo = useVersionTo()

const options = { lazy: true, server: false }
const after = useApi<DropDetail>(() => `/api/drops/${props.version.id}`, { key: () => `version:${props.version.id}`, ...options })
// The first version has nothing before it; the same request (same key) stands in rather than a conditional fetch.
const before = useApi<DropDetail>(() => `/api/drops/${props.previous?.id ?? props.version.id}`, { key: () => `version:${props.previous?.id ?? props.version.id}`, ...options })

const ready = computed(() => after.data.value && (!props.previous || before.data.value))
const error = computed(() => after.error.value ?? (props.previous ? before.error.value : null))
const older = computed(() => (props.previous ? before.data.value ?? null : null))
const text = computed(() => after.data.value?.content !== undefined && (!older.value || older.value.content !== undefined))
const hunks = computed(() => {
  if (!ready.value || !text.value) return []
  const source = after.data.value!.content!
  return older.value ? diffHunks(diffLines(older.value.content!, source)) : source.replace(/\n$/, "").split("\n").map(line => ({ type: "add" as const, text: line }))
})
const counts = computed(() => ({ add: hunks.value.filter(line => line.type === "add").length, remove: hunks.value.filter(line => line.type === "remove").length }))
</script>

<template>
  <section :aria-label="`What changed in v${version.version}`" class="absolute inset-0 z-10 flex flex-col bg-default">
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-default pr-2 pl-4 text-sm" :style="{ paddingRight: inset ? `${inset}px` : undefined }">
      <span class="font-medium text-highlighted">v{{ version.version }}</span>
      <span class="shrink-0 text-muted">{{ previous ? `vs v${previous.version}` : "first version" }}</span>
      <span v-if="ready && text" class="shrink-0 font-mono text-xs"><span class="text-success">+{{ counts.add }}</span> <span class="text-error">−{{ counts.remove }}</span></span>
      <span v-if="version.note" class="min-w-0 truncate text-muted">· {{ version.note }}</span>
      <span class="flex-1" />
      <UButton v-if="!version.current" class="shrink-0" color="neutral" :label="`Open v${version.version}`" size="xs" :to="versionTo(version)" variant="ghost" />
      <UTooltip :kbds="['Esc']" text="Back to the document">
        <UButton aria-label="Back to the document" color="neutral" icon="i-ph-x" size="xs" variant="ghost" @click="emit('close')" />
      </UTooltip>
    </div>

    <div class="min-h-0 flex-1 overflow-auto px-4 py-6 sm:px-8" :style="{ paddingRight: inset ? `${inset}px` : undefined }">
      <p v-if="error" class="py-10 text-center text-sm text-muted">{{ errorText(error, "Couldn't open that version.") }}</p>
      <p v-else-if="!ready" class="py-10 text-center text-sm text-muted">Loading v{{ version.version }}…</p>

      <template v-else-if="text">
        <p v-if="!counts.add && !counts.remove" class="py-10 text-center text-sm text-muted">The source didn't change.</p>
        <div v-else class="mx-auto max-w-3xl overflow-x-auto rounded-md border border-default font-mono text-xs leading-5">
          <template v-for="(line, index) in hunks" :key="index">
            <div v-if="line.type === 'gap'" class="border-y border-default bg-elevated px-3 py-1 text-dimmed">{{ line.lines }} unchanged {{ line.lines === 1 ? "line" : "lines" }}</div>
            <div
              v-else
              class="px-3 whitespace-pre"
              :class="{ 'bg-success/10 text-highlighted': line.type === 'add', 'bg-error/10 text-muted line-through decoration-error/40': line.type === 'remove' }"
            ><span class="mr-3 inline-block w-3 text-dimmed select-none">{{ line.type === "add" ? "+" : line.type === "remove" ? "−" : "" }}</span>{{ line.text || " " }}</div>
          </template>
        </div>
      </template>

      <div v-else-if="after.data.value!.kind === 'image'" class="mx-auto grid max-w-4xl gap-4" :class="older && 'md:grid-cols-2'">
        <figure v-for="side in [older, after.data.value!].filter(Boolean) as DropDetail[]" :key="side.id" class="space-y-2">
          <figcaption class="label-mono">v{{ side.version }}</figcaption>
          <img :alt="`v${side.version}`" class="w-full rounded-md border border-default" :src="side.url">
        </figure>
      </div>

      <!-- TODO(diff): PDFs and other files have no preview to compare yet, so this only names the files. -->
      <ul v-else class="mx-auto max-w-md space-y-2 py-6 text-sm">
        <li v-for="side in [older, after.data.value!].filter(Boolean) as DropDetail[]" :key="side.id" class="flex items-center gap-3">
          <span class="label-mono w-8">v{{ side.version }}</span>
          <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ side.filename }}</span>
          <span class="text-muted tabular-nums">{{ formatBytes(side.size) }}</span>
          <UButton v-if="side.url" aria-label="Download" color="neutral" icon="i-ph-download-simple" size="xs" :to="side.url" external target="_blank" variant="ghost" />
        </li>
      </ul>
    </div>
  </section>
</template>
