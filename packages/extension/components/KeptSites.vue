<script setup lang="ts">
import { hostOf } from "../lib/page"

defineProps<{ sites: string[]; busy?: boolean }>()
const emit = defineEmits<{ remove: [origin: string] }>()
</script>

<template>
  <ul v-if="sites.length" class="divide-y divide-default rounded-lg border border-default" data-testid="kept-sites">
    <li v-for="origin in sites" :key="origin" class="flex items-center gap-3 py-2 ps-3 pe-2">
      <UIcon name="i-mingcute-world-2-line" class="size-4 shrink-0 text-muted" />
      <span class="min-w-0 flex-1 truncate font-mono text-sm">{{ origin.replace(/^https:\/\//, "") }}</span>
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-mingcute-delete-2-line"
        :aria-label="`Remove ${hostOf(origin)}`"
        :disabled="busy"
        @click="emit('remove', origin)"
      />
    </li>
  </ul>
  <p v-else class="rounded-lg border border-dashed border-default p-4 text-sm text-muted">
    None yet. Open the Drop button on a site and turn on On this site.
  </p>
</template>
