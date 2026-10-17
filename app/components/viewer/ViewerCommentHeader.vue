<script setup lang="ts">
import type { DropComment } from "#shared/types"

/** `current`: the version being viewed, so a comment carried over from an earlier one says which. */
defineProps<{ comment: DropComment; current?: number }>()
</script>

<template>
  <div class="flex items-center gap-2">
    <span
      class="grid size-5 shrink-0 place-items-center rounded-full font-mono text-[11px] font-medium"
      :class="comment.resolved ? 'bg-elevated text-muted' : 'bg-inverted text-inverted'"
    >{{ comment.n }}</span>
    <span class="text-sm font-medium text-highlighted">{{ comment.authorName }}</span>
    <span class="font-mono text-xs text-muted"><TimeAgo :at="comment.createdAt" /></span>
    <UBadge v-if="current && comment.version < current" color="neutral" :label="`v${comment.version}`" size="sm" :title="`Written on v${comment.version}`" variant="soft" />
    <span v-if="comment.page" class="ml-auto truncate font-mono text-[11px] text-dimmed">{{ comment.page }}</span>
  </div>
</template>
