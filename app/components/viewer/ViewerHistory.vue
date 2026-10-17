<script setup lang="ts">
// A doc's versions as a timeline, newest first: what each one changed (its note), who published it, and the comments
// written on it. Any other version opens, or compares with this one.
import type { DropComment, DropDetail, DropVersion } from "#shared/types"

const props = defineProps<{ drop: DropDetail; comments: DropComment[] }>()
const emit = defineEmits<{ compare: [version: DropVersion] }>()

// Comments come up to the version being viewed (listComments), so later versions have none to count here.
function talk(version: DropVersion) {
  if (version.version > props.drop.version) return ""
  const written = props.comments.filter(comment => comment.version === version.version)
  if (!written.length) return ""
  const open = written.filter(comment => !comment.resolved).length
  return `${written.length} ${written.length === 1 ? "comment" : "comments"}${open ? `, ${open} open` : ""}`
}
</script>

<template>
  <!-- TODO(repo-mirror): once versions also go to a repo the owner picks (@vite-hub/forge, see server/utils/drops.ts),
       link each version to its commit here. -->
  <ol class="space-y-4 p-4">
    <li v-for="(version, index) in drop.versions" :key="version.id" class="relative flex gap-3 text-[13px]">
      <span v-if="index < drop.versions.length - 1" class="absolute top-4 left-[4.5px] h-[calc(100%+0.5rem)] w-px bg-(--ui-border)" />
      <span class="mt-1.5 size-2.5 shrink-0 rounded-full" :class="version.current ? 'bg-inverted' : 'bg-accented'" />
      <div class="min-w-0 flex-1 space-y-0.5">
        <div class="flex items-center gap-2">
          <p v-if="version.current" class="font-medium text-highlighted">v{{ version.version }} · This version</p>
          <NuxtLink v-else class="truncate hover:underline" :to="`/drops/${version.id}`">v{{ version.version }}</NuxtLink>
          <UButton v-if="!version.current" class="-my-1 ml-auto" color="neutral" label="Compare" size="xs" variant="ghost" @click="emit('compare', version)" />
        </div>
        <p v-if="version.note" class="text-highlighted">{{ version.note }}</p>
        <p class="text-xs text-muted">{{ version.actorName }} · <TimeAgo :at="version.createdAt" /></p>
        <p v-if="talk(version)" class="text-xs text-muted">{{ talk(version) }}</p>
      </div>
    </li>
  </ol>
</template>
