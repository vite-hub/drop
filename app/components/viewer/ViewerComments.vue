<script setup lang="ts">
import type { DropComment, DropVersion } from "#shared/types"

const props = defineProps<{ comments: DropComment[]; canComment: boolean; canManage: boolean; version: number; versions: DropVersion[]; outdated: Set<string> }>()
const emit = defineEmits<{ focus: [comment: DropComment]; resolve: [id: string, resolved: boolean] }>()
const filter = ref<"open" | "resolved">("open")
const tabs = computed(() => [
  { label: "Open", value: "open", badge: props.comments.filter(comment => !comment.resolved).length },
  { label: "Resolved", value: "resolved", badge: props.comments.filter(comment => comment.resolved).length },
])
const visible = computed(() => props.comments.filter(comment => (filter.value === "open" ? !comment.resolved && !props.outdated.has(comment.id) : comment.resolved)))
// Open comments from an earlier version whose text or element this version no longer has. They stay open (the doc
// changed, the point may still stand) but sit apart, each with a link to the version it was written on.
const earlier = computed(() => (filter.value === "open" ? props.comments.filter(comment => !comment.resolved && props.outdated.has(comment.id)) : []))
const versionId = (version: number) => props.versions.find(item => item.version === version)?.id
</script>

<template>
  <div class="flex h-full flex-col">
    <UTabs v-model="filter" class="shrink-0 px-4" color="neutral" :content="false" :items="tabs" size="sm" variant="link" />
    <ul class="min-h-0 flex-1 divide-y divide-default overflow-y-auto border-t border-default">
      <li v-if="!visible.length && !earlier.length" class="px-4 py-10 text-center text-sm text-muted">
        {{ filter === "resolved" ? "Nothing resolved yet." : canComment ? "Select text, click an image, or press R to comment on an area." : "No comments yet." }}
      </li>
      <li v-for="comment in visible" :key="comment.id" class="space-y-2 px-4 py-3">
        <button class="w-full cursor-pointer space-y-2 text-left" type="button" @click="emit('focus', comment)">
          <ViewerCommentHeader :comment="comment" :current="version" />
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
      <li v-if="earlier.length" class="bg-elevated/50 px-4 py-2">
        <p class="label-mono">From earlier versions</p>
        <p class="mt-0.5 text-xs text-muted">What these point at changed or is gone in v{{ version }}.</p>
      </li>
      <li v-for="comment in earlier" :key="comment.id" class="space-y-2 px-4 py-3">
        <ViewerCommentHeader :comment="comment" :current="version" />
        <p v-if="comment.quote" class="line-clamp-3 border-l-2 border-dashed border-default pl-2.5 text-[13px] text-dimmed line-through decoration-(--ui-border-accented)">{{ comment.quote }}</p>
        <p class="text-sm">{{ comment.body }}</p>
        <div class="flex items-center gap-3 text-xs">
          <NuxtLink v-if="versionId(comment.version)" class="text-muted hover:text-highlighted" :to="`/drops/${versionId(comment.version)}`">See it on v{{ comment.version }}</NuxtLink>
          <button v-if="canManage || comment.mine" class="cursor-pointer text-muted hover:text-highlighted" type="button" @click="emit('resolve', comment.id, true)">Resolve</button>
        </div>
      </li>
    </ul>
  </div>
</template>
