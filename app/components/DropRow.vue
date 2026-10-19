<script setup lang="ts">
import { isPublic, type Share, SHARE_HINTS, SHARE_ICONS } from "#shared/share"
import type { DropSummary } from "#shared/types"
import { dropPath } from "#shared/links"

// A folder's row opens in place: its icon toggles the drops in it, indented one step per level (`depth`). In a team
// folder (`inTeam`) anyone may move a teammate's drop to the Trash.
const props = withDefaults(defineProps<{ drop: DropSummary; depth?: number; open?: boolean; inTeam?: boolean }>(), { depth: 0, open: false, inTeam: false })
const emit = defineEmits<{ delete: []; restore: []; deleteForever: []; toggle: [] }>()
const INDENT = ["pl-4", "pl-10", "pl-16", "pl-22", "pl-28", "pl-34", "pl-40", "pl-46"]
const trashed = computed(() => props.drop.trashedAt !== null)
const notify = useNotify()
const { copy } = useCopy()
const { setShare } = useDropActions()
const moveTo = useMoveDialog()
const folder = computed(() => props.drop.kind === "folder")
const shared = computed(() => props.drop.share !== "private")
// Someone else's drop, in Shared with me or a team folder: open it and copy its link; in a team folder, trash it too.
const theirs = computed(() => Boolean(props.drop.owner))
const { data: me } = useMe()
// The team's folders are the admins' to share.
const changeable = computed(() => !theirs.value && (!props.drop.teamFolder || me.value?.role === "admin"))
const choices = computed(() => shareItems(me.value, props.drop))
const status = computed(() => shareStatus(props.drop))

const link = useShareUrl(() => props.drop)
const detail = computed(() => {
  const where = props.drop.path?.length ? ` · in ${props.drop.path.map(crumb => crumb.title).join(" / ")}` : ""
  if (folder.value) return `${itemCount(props.drop.items ?? 0)}${where}`
  return `${props.drop.kind === "app" && props.drop.paths ? `${props.drop.filename} · ${props.drop.paths.length} files` : props.drop.filename}${where}`
})

async function pick(next: Share) {
  if (next === props.drop.share) return true
  if (!await setShare(props.drop, next)) return false
  notify.done(SHARED_TITLES[next], SHARE_HINTS[next])
  return true
}

async function copyLink() {
  // Copying never widens a share on its own: the toast says who each choice lets in, and the team comes first.
  if (!shared.value && changeable.value) {
    const shareAndCopy = (next: Share) => async () => {
      if (await pick(next)) await copyLink()
    }
    const team = choices.value.some(item => item.value === "team")
    const open = choices.value.some(item => item.value === "public")
    notify.info({
      title: "Only you can open this",
      description: team ? "Share it with the team, or turn on a public link anyone can open." : open ? "Turn on a public link to copy it. Anyone with the link can open it." : "Share it before you copy its link.",
      actions: [
        ...(team ? [{ label: "Share with team & copy", color: "neutral" as const, variant: "outline" as const, onClick: shareAndCopy("team") }] : []),
        ...(open ? [{ label: "Public link & copy", color: "neutral" as const, variant: team ? "ghost" as const : "outline" as const, onClick: shareAndCopy("public") }] : []),
      ],
    })
    return
  }
  await copy(link.value, "Link copied")
}

const menu = computed(() => [
  [
    { label: "Open", icon: "i-ph-eye", to: `/drops/${props.drop.id}` },
    { label: isPublic(props.drop.share) ? "Open public page" : "Open shared page", icon: "i-ph-arrow-square-out", to: dropPath(props.drop), target: "_blank", disabled: !shared.value },
    { label: "Copy link", icon: "i-ph-link", onSelect: copyLink },
  ],
  ...(changeable.value ? [[
    { label: "Move to folder", icon: "i-ph-folder-simple-plus", onSelect: () => void moveTo({ drop: props.drop }) },
    { label: "Move to Trash", icon: "i-ph-trash", onSelect: () => emit("delete") },
  ]] : theirs.value && props.inTeam ? [[{ label: "Move to Trash", icon: "i-ph-trash", onSelect: () => emit("delete") }]] : []),
])
</script>

<template>
  <li class="group relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 py-3 pr-4 transition-colors hover:bg-muted md:grid-cols-[auto_minmax(0,1fr)_8.5rem_8rem_auto]" :class="INDENT[Math.min(depth, INDENT.length - 1)]">
    <button
      v-if="folder && drop.items && !trashed"
      :aria-expanded="open"
      :aria-label="`${open ? 'Collapse' : 'Expand'} ${drop.title}`"
      class="relative z-10 grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg bg-elevated text-muted ring-1 ring-inset ring-default transition-colors hover:text-highlighted"
      type="button"
      @click="emit('toggle')"
    >
      <UIcon :name="open ? 'i-ph-folder-open' : 'i-ph-folder'" class="size-[18px]" />
    </button>
    <span v-else class="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated text-muted ring-1 ring-inset ring-default">
      <UIcon :name="KIND_ICONS[drop.kind] ?? 'i-ph-file'" class="size-[18px]" />
    </span>
    <div class="min-w-0">
      <NuxtLink class="flex min-w-0 items-center gap-2 after:absolute after:inset-0" :to="`/drops/${drop.id}`">
        <span class="truncate font-medium text-highlighted">{{ drop.title }}</span>
        <UBadge v-if="drop.version > 1" class="hidden sm:inline-flex" color="neutral" icon="i-ph-clock-counter-clockwise" :label="`v${drop.version}`" size="sm" variant="outline" />
        <ExpiryBadge v-if="!drop.parentId" class="shrink-0" :drop="drop" />
      </NuxtLink>
      <p class="mt-0.5 truncate font-mono text-xs text-muted">
        <template v-if="folder">{{ detail }}<span class="md:hidden"> · <TimeAgo :at="drop.updatedAt" /></span></template>
        <!-- A site review holds no file: its address says more than "0 B". -->
        <template v-else-if="drop.kind === 'site'">{{ detail }}<span class="md:hidden"> · <TimeAgo :at="drop.updatedAt" /></span></template>
        <template v-else><span class="hidden sm:inline">{{ detail }} · </span>{{ formatBytes(drop.size) }}<span class="md:hidden"> · <TimeAgo :at="drop.updatedAt" /></span></template>
      </p>
      <!-- A search that matched the doc's text, not its name: the words around the match. -->
      <p v-if="drop.snippet" class="mt-1 line-clamp-2 text-sm text-muted">{{ drop.snippet }}</p>
    </div>
    <div class="hidden min-w-0 md:block">
      <span v-if="drop.owner" class="flex min-w-0 items-center gap-1.5 text-sm text-highlighted" :title="drop.owner.name">
        <UAvatar :alt="drop.owner.name" class="size-3.5 text-[8px]" :src="drop.owner.image ?? undefined" />
        <span class="truncate">{{ drop.owner.name }}</span>
      </span>
      <span v-else class="flex min-w-0 items-center gap-1.5 text-sm text-highlighted" :title="drop.actorName">
        <AgentIcon class="size-3.5" :kind="drop.actorKind" :name="drop.actorName" />
        <span class="truncate">{{ drop.actorName }}</span>
      </span>
      <span class="mt-0.5 block text-xs text-muted tabular-nums"><TimeAgo :at="drop.updatedAt" /></span>
    </div>
    <span v-if="trashed" class="hidden text-sm text-muted md:block">{{ drop.trashReason === "expired" ? "Expired" : "Deleted" }}</span>
    <span v-else-if="!changeable" class="hidden items-center gap-1.5 text-sm text-muted md:flex">
      <UIcon :name="SHARE_ICONS[drop.share]" class="size-3.5" />{{ drop.teamFolder ? "The team's" : status }}
    </span>
    <!-- Shared through a folder above: the folder's share is changed there, this drop's own on its page. -->
    <span v-else-if="drop.sharedFrom" class="hidden min-w-0 items-center gap-1.5 text-sm text-muted md:flex" :title="`Shared through ${drop.sharedFrom.title}`">
      <UIcon :name="SHARE_ICONS[drop.share]" class="size-3.5 shrink-0" /><span class="truncate">Via {{ drop.sharedFrom.title }}</span>
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
      <UButton color="neutral" icon="i-ph-arrow-u-up-left" label="Restore" size="sm" variant="outline" @click="emit('restore')" />
      <UButton :aria-label="`Delete ${drop.title} for good`" color="error" icon="i-ph-trash" size="sm" variant="ghost" @click="emit('deleteForever')" />
    </div>
    <div v-else class="relative z-10 flex items-center gap-0.5">
      <UButton aria-label="Copy link" class="hidden sm:inline-flex" color="neutral" icon="i-ph-link" variant="ghost" @click="copyLink" />
      <UDropdownMenu :items="menu" :content="{ align: 'end' }">
        <UButton :aria-label="`Actions for ${drop.title}`" color="neutral" icon="i-ph-dots-three" variant="ghost" />
      </UDropdownMenu>
    </div>
  </li>
</template>
