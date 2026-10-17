<script setup lang="ts">
// Details as label/value rows, like an inspector: who dropped it, what it is, who can see it, how long it lives,
// its history. Each row's action sits at its end.
import { type DropDetail, VISIBILITY_ICONS } from "#shared/types"

const props = defineProps<{ drop: DropDetail }>()
const emit = defineEmits<{ share: [] }>()
const type = computed(() => [
  KIND_LABELS[props.drop.kind] ?? "File",
  ...(props.drop.kind === "app" ? [`${props.drop.paths?.length ?? 0} files`] : []),
  formatBytes(props.drop.size),
].join(" · "))
const access = computed(() => {
  if (props.drop.shareReview === "pending") return "Waiting for review"
  if (props.drop.shareReview === "rejected") return "Share rejected"
  if (props.drop.visibility === "private") return "Only you"
  const who = props.drop.visibility === "team" ? "Your team" : "Anyone"
  return `${who} can ${props.drop.access}`
})
</script>

<template>
  <div class="space-y-6 p-4">
    <dl class="space-y-2.5 text-[13px]">
      <div class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">Dropped by</dt>
        <dd class="flex min-w-0 items-center gap-1.5">
          <AgentIcon class="size-3.5 shrink-0 text-muted" :kind="drop.actorKind" :name="drop.actorName" />
          <span class="truncate text-highlighted">{{ drop.actorName }}</span>
          <span class="shrink-0 text-muted">via {{ VIA_LABELS[drop.actorKind] }}</span>
        </dd>
      </div>
      <div class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">Updated</dt>
        <dd class="text-highlighted"><TimeAgo :at="drop.updatedAt" /></dd>
      </div>
      <div class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">File</dt>
        <dd class="min-w-0 truncate font-mono text-xs text-highlighted">{{ drop.filename }}</dd>
      </div>
      <div class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">Type</dt>
        <dd class="text-highlighted tabular-nums">{{ type }}</dd>
      </div>
      <div v-if="drop.isOwner" class="flex items-center gap-3">
        <dt class="w-20 shrink-0 text-muted">Access</dt>
        <dd class="flex min-w-0 flex-1 items-center gap-1.5 text-highlighted">
          <UIcon :name="VISIBILITY_ICONS[drop.visibility]" class="size-3.5 shrink-0 text-muted" />
          <span class="truncate">{{ access }}</span>
        </dd>
        <UButton class="-my-1" color="neutral" label="Change" size="xs" variant="ghost" @click="emit('share')" />
      </div>
    </dl>

    <ViewerLifetime v-if="drop.isOwner" :drop="drop" />

    <section v-if="drop.versions.length > 1">
      <h3 class="label-mono">History</h3>
      <ol class="mt-3 space-y-3">
        <li v-for="(version, index) in drop.versions" :key="version.id" class="relative flex gap-3 text-[13px]">
          <span v-if="index < drop.versions.length - 1" class="absolute top-4 left-[4.5px] h-[calc(100%+0.25rem)] w-px bg-(--ui-border)" />
          <span class="mt-1.5 size-2.5 shrink-0 rounded-full" :class="version.current ? 'bg-inverted' : 'bg-accented'" />
          <div class="min-w-0">
            <p v-if="version.current" class="font-medium text-highlighted">v{{ version.version }} · This version</p>
            <NuxtLink v-else class="block truncate hover:underline" :to="`/drops/${version.id}`">v{{ version.version }} · {{ version.title }}</NuxtLink>
            <p class="text-xs text-muted"><TimeAgo :at="version.createdAt" /></p>
          </div>
        </li>
      </ol>
    </section>

    <section v-if="$slots.actions" class="-mx-2 border-t border-default pt-3">
      <slot name="actions" />
    </section>
  </div>
</template>
