<script setup lang="ts">
import { type DropSummary, type Visibility, VISIBILITY_ICONS } from "#shared/types"
import { dropPath } from "#shared/links"

// A folder's row opens in place: its icon toggles the drops in it, indented one step per level (`depth`).
const props = withDefaults(defineProps<{ drop: DropSummary; depth?: number; open?: boolean }>(), { depth: 0, open: false })
const emit = defineEmits<{ delete: []; restore: []; deleteForever: []; toggle: [] }>()
const INDENT = ["pl-4", "pl-10", "pl-16", "pl-22", "pl-28", "pl-34", "pl-40", "pl-46"]
const trashed = computed(() => props.drop.trashedAt !== null)
const notify = useNotify()
const { copy } = useCopy()
const { setVisibility } = useDropActions()
const moveTo = useMoveDialog()
const folder = computed(() => props.drop.kind === "folder")
const shared = computed(() => props.drop.visibility !== "private")
// Someone else's drop, in Shared with me: open it and copy its link, nothing else.
const theirs = computed(() => Boolean(props.drop.owner))
const AUDIENCES: Record<Visibility, string> = { private: "Private", team: "Team", shared: "Public" }
const audiences = (Object.keys(AUDIENCES) as Visibility[]).map(value => ({ value, label: AUDIENCES[value], icon: VISIBILITY_ICONS[value] }))
const status = computed(() => props.drop.quarantinedAt ? "Quarantined" : props.drop.shareReview === "pending" ? "Pending review" : props.drop.shareReview === "rejected" ? "Rejected" : AUDIENCES[props.drop.visibility])

const link = useShareUrl(() => props.drop)
const detail = computed(() => {
  const where = props.drop.path?.length ? ` · in ${props.drop.path.map(crumb => crumb.title).join(" / ")}` : ""
  if (folder.value) return `${itemCount(props.drop.items ?? 0)}${where}`
  return `${props.drop.kind === "app" && props.drop.paths ? `${props.drop.filename} · ${props.drop.paths.length} files` : props.drop.filename}${where}`
})

const SHARED_NOTES: Record<Visibility, string> = { private: "Only you can open it.", team: "Everyone in your team can open it.", shared: "Anyone with the link can open it." }
async function setAudience(next: Visibility) {
  if (next === props.drop.visibility) return
  // Sharing a private Markdown doc with the team means working on it together, so it opens for editing.
  const access = next === "team" && !shared.value && props.drop.kind === "markdown" ? "edit" : undefined
  if (await setVisibility(props.drop, next, access)) notify.done(next === "private" ? "Private again" : "Shared", SHARED_NOTES[next])
}

async function copyLink() {
  if (!shared.value) {
    notify.info({ title: "This drop is private", description: "Share it first so the link works for others.", actions: [{ label: "Share & copy", color: "neutral", variant: "outline", onClick: () => void setAudience("shared").then(copyLink) }] })
    return
  }
  await copy(link.value, "Link copied")
}

const menu = computed(() => [
  [
    { label: "Open", icon: "i-ph-eye", to: `/drops/${props.drop.id}` },
    { label: "Open Public Page", icon: "i-ph-arrow-square-out", to: dropPath(props.drop), target: "_blank", disabled: !shared.value },
    { label: "Copy Link", icon: "i-ph-link", onSelect: copyLink },
  ],
  ...(theirs.value ? [] : [[
    { label: "Move to Folder", icon: "i-ph-folder-simple-plus", onSelect: () => void moveTo({ drop: props.drop }) },
    { label: "Move to Trash", icon: "i-ph-trash", onSelect: () => emit("delete") },
  ]]),
])
</script>

<template>
  <li class="group relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 py-3 pr-4 transition-colors hover:bg-muted md:grid-cols-[auto_minmax(0,1fr)_8.5rem_6.5rem_auto]" :class="INDENT[Math.min(depth, INDENT.length - 1)]">
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
        <template v-else><span class="hidden sm:inline">{{ detail }} · </span>{{ formatBytes(drop.size) }}<span class="md:hidden"> · <TimeAgo :at="drop.updatedAt" /></span></template>
      </p>
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
    <span v-else-if="theirs" class="hidden items-center gap-1.5 text-sm text-muted md:flex">
      <UIcon :name="VISIBILITY_ICONS[drop.visibility]" class="size-3.5" />{{ status }}
    </span>
    <!-- Shared through a folder above: the folder's share is changed there, this drop's own on its page. -->
    <span v-else-if="drop.sharedFrom" class="hidden min-w-0 items-center gap-1.5 text-sm text-muted md:flex" :title="`Shared through ${drop.sharedFrom.title}`">
      <UIcon :name="VISIBILITY_ICONS[drop.visibility]" class="size-3.5 shrink-0" /><span class="truncate">Via {{ drop.sharedFrom.title }}</span>
    </span>
    <USelect
      v-else
      aria-label="Who can open it"
      class="relative z-10 hidden w-full text-sm md:inline-flex"
      :class="shared ? 'text-highlighted' : 'text-muted'"
      color="neutral"
      :icon="VISIBILITY_ICONS[drop.visibility]"
      :items="audiences"
      :model-value="drop.visibility"
      size="sm"
      variant="ghost"
      @update:model-value="setAudience"
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
