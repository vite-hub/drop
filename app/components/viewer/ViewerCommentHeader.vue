<script setup lang="ts">
import type { DropComment } from "#shared/types"

defineProps<{ comment: DropComment }>()
</script>

<template>
  <div class="flex items-center gap-2">
    <span
      class="grid size-5 shrink-0 place-items-center rounded-full font-mono text-[11px] font-medium"
      :class="comment.resolved ? 'bg-elevated text-muted' : 'bg-inverted text-inverted'"
    >{{ comment.n }}</span>
    <span class="text-sm font-medium text-highlighted">{{ comment.authorName }}</span>
    <span class="font-mono text-xs text-muted"><TimeAgo :at="comment.createdAt" /></span>
    <span v-if="comment.page" class="ml-auto truncate font-mono text-[11px] text-dimmed">{{ comment.page }}</span>
  </div>
</template>
