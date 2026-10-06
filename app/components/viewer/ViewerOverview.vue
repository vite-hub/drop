<script setup lang="ts">
// Details as a short story instead of a table: who dropped it, what it is, who can see it, its history.
import { ACCESS_LABELS, type DropDetail } from "#shared/types"

const props = defineProps<{ drop: DropDetail }>()
const emit = defineEmits<{ share: [] }>()
const facts = computed(() => [
  KIND_LABELS[props.drop.kind] ?? "File",
  ...(props.drop.kind === "app" ? [`${props.drop.paths?.length ?? 0} files`] : []),
  formatBytes(props.drop.size),
  ...(props.drop.versions.length > 1 || props.drop.kind === "app" ? [`v${props.drop.version}`] : []),
])
const access = computed(() => props.drop.visibility === "shared" ? `Anyone with the link ${ACCESS_LABELS[props.drop.access].toLowerCase()}.` : "Private. Only you can open it.")
</script>

<template>
  <div class="space-y-6 p-4">
    <section class="flex items-start gap-3">
      <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-elevated ring-1 ring-inset ring-default">
        <AgentIcon class="size-5" :kind="drop.actorKind" :name="drop.actorName" />
      </span>
      <div class="min-w-0 pt-0.5">
        <p class="text-sm"><span class="font-medium text-highlighted">{{ drop.actorName }}</span> <span class="text-muted">dropped this</span></p>
        <p class="mt-0.5 text-xs text-muted"><TimeAgo :at="drop.updatedAt" /> · via {{ VIA_LABELS[drop.actorKind] }}</p>
      </div>
    </section>

    <section class="rounded-lg border border-default p-3">
      <p class="flex min-w-0 items-center gap-2 font-mono text-xs">
        <UIcon :name="KIND_ICONS[drop.kind]!" class="size-3.5 shrink-0 text-dimmed" />
        <span class="truncate">{{ drop.filename }}</span>
      </p>
      <div class="mt-2.5 flex flex-wrap gap-1.5">
        <span v-for="fact in facts" :key="fact" class="rounded-md bg-elevated px-1.5 py-0.5 text-[11px] text-muted">{{ fact }}</span>
      </div>
    </section>

    <section v-if="drop.isOwner" class="flex items-center gap-3">
      <span class="grid size-8 shrink-0 place-items-center rounded-full bg-elevated text-muted">
        <UIcon :name="drop.visibility === 'shared' ? 'i-lucide-globe' : 'i-lucide-lock'" class="size-4" />
      </span>
      <p class="min-w-0 flex-1 text-sm">{{ access }}</p>
      <UButton color="neutral" label="Change" size="sm" variant="ghost" @click="emit('share')" />
    </section>

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
