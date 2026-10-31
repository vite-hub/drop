<script setup lang="ts">
import { SHARE_ICONS } from "#shared/share"
import type { DropSummary } from "#shared/types"
import { daysUntil, purgesAt } from "#shared/expiry"

// A folder's row opens in place: its icon toggles the drops in it, indented one step per level (`depth`). In a team
// folder (`inTeam`) anyone may move a teammate's drop to the Trash.
const {
  drop,
  depth = 0,
  open = false,
  inTeam = false,
} = defineProps<{ drop: DropSummary; depth?: number; open?: boolean; inTeam?: boolean }>()
const emit = defineEmits<{ delete: []; restore: []; deleteForever: []; toggle: [] }>()
const INDENT = ["pl-4", "pl-10", "pl-16", "pl-22", "pl-28", "pl-34", "pl-40", "pl-46"]
const trashed = computed(() => drop.trashedAt !== null)
const now = useRelativeNow()
const purgeDays = computed(() => (drop.trashedAt === null ? 0 : daysUntil(purgesAt(drop.trashedAt), now.value)))
const folder = computed(() => drop.kind === "folder")
const { shared, changeable, choices, status, pick, copyLink, copied, linkChoices, menu } = useDropItem(() => drop, {
  inTeam: () => inTeam,
  trash: () => emit("delete"),
})
const detail = computed(() => {
  const where = drop.path?.length ? ` · in ${drop.path.map((crumb) => crumb.title).join(" / ")}` : ""
  if (folder.value) return `${itemCount(drop.items ?? 0)}${where}`
  return `${drop.kind === "app" && drop.paths ? `${drop.filename} · ${drop.paths.length} files` : drop.filename}${where}`
})
</script>

<template>
  <li
    class="group relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 py-3 pr-4 transition-colors hover:bg-muted md:grid-cols-[auto_minmax(0,1fr)_8.5rem_8rem_auto]"
    :class="INDENT[Math.min(depth, INDENT.length - 1)]"
  >
    <button
      v-if="folder && drop.items && !trashed"
      :aria-expanded="open"
      :aria-label="`${open ? 'Collapse' : 'Expand'} ${drop.title}`"
      class="relative z-10 grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg bg-elevated text-muted ring-1 ring-inset ring-default transition-colors hover:text-highlighted"
      type="button"
      @click="emit('toggle')"
    >
      <UIcon :name="open ? 'i-mingcute-folder-open-line' : 'i-mingcute-folder-line'" class="size-4.5" />
    </button>
    <span
      v-else
      class="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated text-muted ring-1 ring-inset ring-default"
    >
      <UIcon :name="KIND_ICONS[drop.kind]" class="size-4.5" />
    </span>
    <div class="min-w-0">
      <NuxtLink class="flex min-w-0 items-center gap-2 after:absolute after:inset-0" :to="`/drops/${drop.id}`">
        <span class="truncate font-medium text-highlighted">{{ drop.title }}</span>
        <UBadge
          v-if="drop.version > 1"
          class="hidden sm:inline-flex"
          color="neutral"
          icon="i-mingcute-history-line"
          :label="`v${drop.version}`"
          size="sm"
          variant="outline"
        />
        <!-- In the Trash the status column says when it's deleted for good. -->
        <ExpiryBadge v-if="!drop.parentId && !trashed" class="shrink-0" :drop="drop" />
      </NuxtLink>
      <p class="mt-0.5 truncate font-mono text-xs text-muted">
        <template v-if="folder"
          >{{ detail }}<span class="md:hidden"> · <TimeAgo :at="drop.updatedAt" /></span
        ></template>
        <!-- A site review holds no file: its address says more than "0 B". -->
        <template v-else-if="drop.kind === 'site'"
          >{{ detail }}<span class="md:hidden"> · <TimeAgo :at="drop.updatedAt" /></span
        ></template>
        <template v-else
          ><span class="hidden sm:inline">{{ detail }} · </span>{{ formatBytes(drop.size)
          }}<span class="md:hidden"> · <TimeAgo :at="drop.updatedAt" /></span
        ></template>
      </p>
      <!-- A search that matched the doc's text, not its name: the words around the match. -->
      <p v-if="drop.snippet" class="mt-1 line-clamp-2 text-sm text-muted">{{ drop.snippet }}</p>
    </div>
    <div class="hidden min-w-0 md:block">
      <span
        v-if="drop.owner"
        class="flex min-w-0 items-center gap-1.5 text-sm text-highlighted"
        :title="drop.owner.name"
      >
        <UAvatar :alt="drop.owner.name" class="size-3.5 text-[8px]" :src="drop.owner.image ?? undefined" />
        <span class="truncate">{{ drop.owner.name }}</span>
      </span>
      <span v-else class="flex min-w-0 items-center gap-1.5 text-sm text-highlighted" :title="drop.actorName">
        <AgentIcon class="size-3.5" :kind="drop.actorKind" :name="drop.actorName" />
        <span class="truncate">{{ drop.actorName }}</span>
      </span>
      <span class="mt-0.5 block text-xs text-muted tabular-nums"><TimeAgo :at="drop.updatedAt" /></span>
    </div>
    <div v-if="trashed" class="hidden min-w-0 md:block">
      <span class="block text-sm text-highlighted">{{ drop.trashReason === "expired" ? "Expired" : "Deleted" }}</span>
      <span class="mt-0.5 block text-xs tabular-nums" :class="purgeDays <= 3 ? 'text-error' : 'text-muted'">{{
        purgeDays ? `Gone in ${purgeDays}d` : "Gone today"
      }}</span>
    </div>
    <span v-else-if="!changeable" class="hidden items-center gap-1.5 text-sm text-muted md:flex">
      <UIcon :name="SHARE_ICONS[drop.share]" class="size-3.5" />{{ drop.teamFolder ? "The team's" : status }}
    </span>
    <!-- Shared through a folder above: the folder's share is changed there, this drop's own on its page. -->
    <span
      v-else-if="drop.sharedFrom"
      class="hidden min-w-0 items-center gap-1.5 text-sm text-muted md:flex"
      :title="`Shared through ${drop.sharedFrom.title}`"
    >
      <UIcon :name="SHARE_ICONS[drop.share]" class="size-3.5 shrink-0" /><span class="truncate"
        >Via {{ drop.sharedFrom.title }}</span
      >
    </span>
    <USelect
      v-else
      aria-label="Who can open it"
      class="relative z-10 hidden w-full text-sm md:inline-flex"
      :class="shared ? 'text-highlighted' : 'text-muted'"
      color="neutral"
      :icon="SHARE_ICONS[drop.share]"
      :items="choices"
      :model-value="drop.share"
      size="sm"
      variant="ghost"
      @update:model-value="pick"
    >
      <template #default>{{ status }}</template>
    </USelect>
    <div v-if="trashed" class="relative z-10 flex items-center gap-1">
      <UButton
        color="neutral"
        icon="i-mingcute-back-line"
        label="Restore"
        size="sm"
        variant="outline"
        @click="emit('restore')"
      />
      <UButton
        :aria-label="`Delete ${drop.title} for good`"
        color="error"
        icon="i-mingcute-delete-2-line"
        size="sm"
        variant="ghost"
        @click="emit('deleteForever')"
      />
    </div>
    <div v-else class="relative z-10 flex items-center gap-0.5">
      <DeferredMenu v-if="linkChoices" :items="linkChoices" :content="{ align: 'end' }">
        <UButton
          aria-label="Copy link"
          class="hidden sm:inline-flex"
          color="neutral"
          icon="i-mingcute-link-line"
          variant="ghost"
        />
      </DeferredMenu>
      <UButton
        v-else
        aria-label="Copy link"
        class="hidden sm:inline-flex"
        color="neutral"
        :icon="copied() ? 'i-mingcute-check-line' : 'i-mingcute-link-line'"
        :ui="{ leadingIcon: copied() ? 'animate-icon-in' : undefined }"
        variant="ghost"
        @click="copyLink()"
      />
      <DeferredMenu :items="menu" :content="{ align: 'end' }">
        <UButton
          :aria-label="`Actions for ${drop.title}`"
          color="neutral"
          icon="i-mingcute-more-1-fill"
          variant="ghost"
        />
      </DeferredMenu>
    </div>
  </li>
</template>
