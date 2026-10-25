<script setup lang="ts">
import type { DropDetail } from "#shared/types"
import { dropPath } from "#shared/links"

const props = defineProps<{ drop: DropDetail; publicView: boolean }>()
const open = ref(false)
const folderTo = (folder: DropDetail["ancestors"][number]) =>
  props.publicView ? dropPath(folder) : `/drops/${folder.id}`
// Keep the extension visible while CSS truncates the name. The popover shows the full title.
const tail = computed(() => props.drop.title.match(/\.[a-z0-9]{1,8}$/i)?.[0] ?? "")
const head = computed(() => (tail.value ? props.drop.title.slice(0, -tail.value.length) : props.drop.title))
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'start' }">
    <button
      class="flex min-w-0 items-center rounded-md py-1 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inverted"
      :aria-label="`${drop.title}, name and location`"
      :title="drop.title"
      type="button"
    >
      <span v-if="drop.ancestors.length" aria-hidden="true" class="mr-2 hidden shrink-0 text-muted sm:inline">… /</span>
      <span class="truncate">{{ head }}</span
      ><span v-if="tail" class="shrink-0">{{ tail }}</span>
    </button>
    <template #content>
      <div class="w-80 max-w-[calc(100vw-2rem)] p-4">
        <p class="text-sm font-medium wrap-anywhere">{{ drop.title }}</p>
        <nav
          v-if="drop.ancestors.length"
          aria-label="Folder hierarchy"
          class="mt-3 flex flex-col gap-1 border-t border-default pt-3"
        >
          <NuxtLink
            v-for="(folder, index) in drop.ancestors"
            :key="folder.id"
            class="flex min-h-8 items-start gap-2 rounded-md px-2 py-1 text-sm text-muted hover:bg-elevated hover:text-highlighted"
            :style="{ marginLeft: `${Math.min(index, 6) * 8}px` }"
            :to="folderTo(folder)"
            @click="open = false"
          >
            <UIcon name="i-mingcute-folder-line" class="mt-0.5 size-4 shrink-0" />
            <span class="wrap-anywhere">{{ folder.title }}</span>
          </NuxtLink>
        </nav>
        <p v-else class="mt-2 text-xs text-muted">Top-level drop</p>
      </div>
    </template>
  </UPopover>
</template>
