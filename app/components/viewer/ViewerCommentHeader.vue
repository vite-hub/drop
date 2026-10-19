<script setup lang="ts">
import type { DropComment } from "#shared/types"

/** `current`: the version being viewed, so a comment carried over from an earlier one says which. `numbered`: off in
 * the thread, whose bar already names the comment. */
const { numbered = true } = defineProps<{ comment: DropComment; current?: number; numbered?: boolean }>()
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- The author, like the pin in the document; the number stays, since people and agents name comments by it. -->
    <UAvatar
      :alt="comment.authorName"
      :class="comment.resolved && 'opacity-60 grayscale'"
      :src="comment.authorImage ?? undefined"
      size="2xs"
    />
    <span class="text-sm font-medium text-highlighted">{{ comment.authorName }}</span>
    <span class="font-mono text-xs text-muted"
      ><template v-if="numbered">#{{ comment.n }} · </template><TimeAgo :at="comment.createdAt"
    /></span>
    <UBadge
      v-if="current && comment.version < current"
      color="neutral"
      :label="`v${comment.version}`"
      size="sm"
      :title="`Written on v${comment.version}`"
      variant="soft"
    />
    <span v-if="comment.page" class="ml-auto truncate font-mono text-[11px] text-dimmed">{{ comment.page }}</span>
  </div>
</template>
