<script setup lang="ts">
// A link item's page: the page it opens, with its site's icon, what the address says (a pull request's repo#number),
// and the note on what it is. Comments, Details and the share controls work as on any drop.
import { linkSource } from "#shared/resources"
import type { DropDetail } from "#shared/types"

const props = defineProps<{ drop: DropDetail }>()
const href = computed(() => props.drop.href!)
</script>

<template>
  <div class="grid flex-1 place-items-center p-6 sm:p-10">
    <div class="w-full max-w-md rounded-lg border border-default bg-default p-5">
      <div class="flex items-center gap-2 text-sm text-muted">
        <ViewerResourceIcon :url="href" />
        <span class="truncate font-mono text-xs">{{ linkSource(href) }}</span>
      </div>
      <p class="mt-2 text-lg font-medium text-pretty text-highlighted">{{ drop.title }}</p>
      <p v-if="drop.note" class="mt-1 text-sm text-pretty text-muted">{{ drop.note }}</p>
      <p class="mt-3 truncate font-mono text-xs text-dimmed" :title="href">{{ href }}</p>
      <UButton
        class="mt-4"
        color="neutral"
        :href="href"
        icon="i-mingcute-external-link-line"
        label="Open"
        rel="noopener noreferrer"
        target="_blank"
      />
    </div>
  </div>
</template>
