<script setup lang="ts">
import type { DropComment } from "#shared/types"

const props = defineProps<{ comments: DropComment[]; canComment: boolean; canManage: boolean }>()
const emit = defineEmits<{ focus: [comment: DropComment]; resolve: [id: string, resolved: boolean] }>()
const filter = ref<"open" | "resolved">("open")
const tabs = computed(() => [
  { label: "Open", value: "open", badge: props.comments.filter(comment => !comment.resolved).length },
  { label: "Resolved", value: "resolved", badge: props.comments.filter(comment => comment.resolved).length },
])
const visible = computed(() => props.comments.filter(comment => (filter.value === "open" ? !comment.resolved : comment.resolved)))
</script>

<template>
  <div class="flex h-full flex-col">
    <UTabs v-model="filter" class="shrink-0 px-4" color="neutral" :content="false" :items="tabs" size="sm" variant="link" />
    <ul class="min-h-0 flex-1 divide-y divide-default overflow-y-auto border-t border-default">
      <li v-if="!visible.length" class="px-4 py-10 text-center text-sm text-muted">
        {{ filter === "resolved" ? "Nothing resolved yet." : canComment ? "Select text or click an image to comment." : "No comments yet." }}
      </li>
      <li v-for="comment in visible" :key="comment.id" class="space-y-2 px-4 py-3">
        <button class="w-full cursor-pointer space-y-2 text-left" type="button" @click="emit('focus', comment)">
          <ViewerCommentHeader :comment="comment" />
          <p v-if="comment.quote" class="line-clamp-3 border-l-2 border-default pl-2.5 text-[13px] text-muted">{{ comment.quote }}</p>
          <p class="text-sm">{{ comment.body }}</p>
        </button>
        <button
          v-if="canManage || comment.mine"
          class="cursor-pointer text-xs text-muted hover:text-highlighted"
          type="button"
          @click="emit('resolve', comment.id, !comment.resolved)"
        >
          {{ comment.resolved ? "Reopen" : "Resolve" }}
        </button>
      </li>
    </ul>
  </div>
</template>
