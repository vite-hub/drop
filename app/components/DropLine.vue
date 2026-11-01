<script setup lang="ts">
// A drop on the Drops page's list, read like a list of posts: its name, a word on what it is, and when, right-aligned in
// fixed-width digits. No boxes, no rules between lines; whitespace keeps them apart. Hovering, or focus inside, swaps
// the time for Copy link and the ⋯ menu. The page decides what a click does (`pick`), as with DropCard.
import { SHARE_ICONS } from "#shared/share"
import type { DropSummary } from "#shared/types"

const {
  drop,
  selected = false,
  inTeam = false,
} = defineProps<{
  drop: DropSummary
  selected?: boolean
  inTeam?: boolean
}>()
const emit = defineEmits<{ pick: [event: MouseEvent]; delete: [] }>()
const { shared, status, copyLink, copied, linkChoices, menu } = useDropItem(() => drop, {
  inTeam: () => inTeam,
  trash: () => emit("delete"),
})
const about = computed(() => {
  if (drop.path?.length) return `in ${drop.path.map((crumb) => crumb.title).join(" / ")}`
  if (drop.kind === "folder") return drop.items ? itemCount(drop.items) : "Empty"
  return KIND_LABELS[drop.kind]
})
</script>

<template>
  <li class="group relative" :data-id="drop.id">
    <NuxtLink
      :aria-current="selected ? 'true' : undefined"
      class="-mx-2 flex h-10 min-w-0 items-center gap-3 rounded-md px-2 text-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted)"
      :class="selected ? 'bg-accented/70' : 'hover:bg-elevated'"
      :to="`/drops/${drop.id}`"
      draggable="false"
      @click.capture="emit('pick', $event)"
    >
      <img
        v-if="drop.thumbnail"
        alt=""
        class="size-4 shrink-0 rounded-[3px] object-cover object-top outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        loading="lazy"
        :src="drop.thumbnail"
      />
      <UIcon v-else :name="KIND_ICONS[drop.kind]" class="size-4 shrink-0 text-muted" />
      <span
        class="truncate"
        :class="drop.kind === 'folder' && drop.items === 0 ? 'text-muted' : 'font-medium text-highlighted'"
        >{{ drop.title }}</span
      >
      <ExpiryBadge v-if="!drop.parentId" class="shrink-0 max-sm:hidden" :drop="drop" />
      <span class="hidden min-w-0 shrink-[100] truncate text-muted sm:block">{{ about }}</span>
      <span
        class="ml-auto flex shrink-0 items-center gap-3 text-muted group-focus-within:invisible group-hover:invisible"
      >
        <UIcon v-if="shared" :aria-label="status" class="size-3.5" :name="SHARE_ICONS[drop.share]" role="img" />
        <TimeAgo class="w-24 text-right tabular-nums" :at="drop.updatedAt" />
      </span>
    </NuxtLink>
    <div
      class="invisible absolute inset-y-0 right-0 flex items-center gap-0.5 group-focus-within:visible group-hover:visible pointer-coarse:visible"
    >
      <DeferredMenu v-if="linkChoices" :items="linkChoices" :content="{ align: 'end' }">
        <UButton aria-label="Copy link" color="neutral" icon="i-mingcute-link-line" size="xs" variant="ghost" />
      </DeferredMenu>
      <UButton
        v-else
        aria-label="Copy link"
        color="neutral"
        :icon="copied() ? 'i-mingcute-check-line' : 'i-mingcute-link-line'"
        size="xs"
        :ui="{ leadingIcon: copied() ? 'animate-icon-in' : undefined }"
        variant="ghost"
        @click="copyLink()"
      />
      <DeferredMenu :items="menu" :content="{ align: 'end' }">
        <UButton
          :aria-label="`Actions for ${drop.title}`"
          color="neutral"
          icon="i-mingcute-more-1-fill"
          size="xs"
          variant="ghost"
        />
      </DeferredMenu>
    </div>
  </li>
</template>
