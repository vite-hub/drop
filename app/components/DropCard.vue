<script setup lang="ts">
// A drop on the Drops page's grid: its preview (DropPreview, from usePeek) above its name, who dropped it and when,
// and a globe or a team when it's shared. Hovering, or focus inside, brings up Copy link and the ⋯ menu over the
// preview's corner. The page decides what a click does (`pick`): one click previews, a double-click or Enter opens.
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
const peek = usePeek(() => drop)
const { shared, status, copyLink, copied, linkChoices, menu } = useDropItem(() => drop, {
  inTeam: () => inTeam,
  trash: () => emit("delete"),
})
const where = computed(() => drop.path?.map((crumb) => crumb.title).join(" / "))
const address = computed(() => (drop.kind === "app" ? drop.filename.replace(/\/$/, "") : drop.filename))
</script>

<template>
  <li class="group relative" :data-id="drop.id">
    <NuxtLink
      :aria-current="selected ? 'true' : undefined"
      class="block rounded-xl outline-none select-none focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted) focus-visible:ring-offset-4 focus-visible:ring-offset-(--ui-bg)"
      :to="`/drops/${drop.id}`"
      draggable="false"
      @click.capture="emit('pick', $event)"
    >
      <div
        class="relative aspect-[16/10] overflow-hidden rounded-xl bg-muted shadow-[0_0_0_1px_rgb(0_0_0/.07),0_1px_2px_rgb(0_0_0/.05)] transition-shadow duration-150 dark:shadow-[0_0_0_1px_rgb(255_255_255/.09)]"
        :class="
          selected
            ? 'shadow-[0_0_0_2px_var(--ui-border-inverted)]! dark:shadow-[0_0_0_2px_var(--ui-border-inverted)]!'
            : 'group-hover:shadow-[0_0_0_1px_rgb(0_0_0/.1),0_2px_4px_rgb(0_0_0/.06),0_12px_24px_-12px_rgb(0_0_0/.2)] dark:group-hover:shadow-[0_0_0_1px_rgb(255_255_255/.14)]'
        "
      >
        <DropPreview
          :address="address"
          :items="drop.items"
          :kind="drop.kind"
          :peek="peek"
          :thumbnail="drop.thumbnail"
          :title="drop.title"
        />
        <span
          v-if="drop.kind === 'folder' && drop.items"
          class="absolute right-2 bottom-2 z-40 rounded-full bg-black/70 px-2 font-mono text-[11px] leading-5 text-white tabular-nums backdrop-blur-sm"
          >{{ itemCount(drop.items) }}</span
        >
      </div>
      <div class="mt-2.5 flex min-w-0 items-center gap-1.5 px-0.5">
        <UIcon :name="KIND_ICONS[drop.kind]" class="size-3.5 shrink-0 text-muted" />
        <span
          class="truncate text-sm font-medium"
          :class="drop.kind === 'folder' && drop.items === 0 ? 'font-normal text-muted' : 'text-highlighted'"
          >{{ drop.title }}</span
        >
        <ExpiryBadge v-if="!drop.parentId" class="shrink-0" :drop="drop" />
      </div>
      <p class="mt-0.5 flex min-w-0 items-center gap-1.5 px-0.5 text-xs text-muted">
        <span class="truncate">
          <template v-if="where">in {{ where }} · </template>
          <template v-if="drop.version > 1">v{{ drop.version }} · </template>{{ drop.owner?.name ?? drop.actorName }} ·
          <TimeAgo :at="drop.updatedAt" />
        </span>
        <UIcon
          v-if="shared"
          :aria-label="status"
          class="ml-auto size-3.5 shrink-0"
          :name="SHARE_ICONS[drop.share]"
          role="img"
        />
      </p>
    </NuxtLink>
    <div
      class="absolute top-2 right-2 z-50 flex gap-0.5 rounded-lg bg-default p-0.5 opacity-0 shadow-md ring-1 ring-default transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
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
