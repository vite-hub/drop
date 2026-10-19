<script setup lang="ts">
// A folder's search results: drops anywhere below it whose name or text has every word, with the folders between and
// the words around a match in a doc. Searching needs a signed-in person (/api/drops), so public visitors never see it.
import { dropPath } from "#shared/links"
import type { DropSummary } from "#shared/types"

const props = defineProps<{ folder: string; query: string; publicView?: boolean }>()
const query = refDebounced(computed(() => props.query.trim()), 200)
const { data: found, status } = useApi<DropSummary[]>("/api/drops", {
  key: () => keys.folderSearch(props.folder),
  query: computed(() => ({ folder: props.folder, q: query.value })),
  default: () => [],
  // It mounts with the first word typed, so that fetch goes out at once; later words refetch through `query`.
  server: false,
})
// Until the debounced words reach the server, the last results would answer the new words.
const pending = computed(() => status.value === "pending" || query.value !== props.query.trim())
const to = (drop: DropSummary) => (props.publicView ? dropPath(drop) : `/drops/${drop.id}`)
const meta = (drop: DropSummary) => [drop.path?.length ? `in ${drop.path.map(crumb => crumb.title).join(" / ")}` : "", drop.kind === "folder" ? itemCount(drop.items ?? 0) : KIND_LABELS[drop.kind]].filter(Boolean).join(" · ")
</script>

<template>
  <div aria-live="polite">
    <p v-if="pending && !found.length" class="py-16 text-center text-sm text-muted">Searching…</p>
    <p v-else-if="!found.length" class="py-16 text-center text-sm text-muted">Nothing in this folder matches.</p>
    <ul v-else class="divide-y divide-default overflow-hidden rounded-lg border border-default" :class="pending && 'opacity-60'">
      <li v-for="drop in found" :key="drop.id">
        <NuxtLink class="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted" :to="to(drop)">
          <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated text-muted ring-1 ring-inset ring-default">
            <UIcon :name="KIND_ICONS[drop.kind]" class="size-[18px]" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-highlighted">{{ drop.title }}</span>
            <span class="mt-0.5 block truncate text-xs text-muted">{{ meta(drop) }} · <TimeAgo :at="drop.updatedAt" /></span>
            <span v-if="drop.snippet" class="mt-1 line-clamp-2 block text-sm text-muted">{{ drop.snippet }}</span>
          </span>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
