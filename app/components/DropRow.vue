<script setup lang="ts">
import { isPublic, type Share, SHARE_ICONS } from "#shared/share"
import type { DropSummary } from "#shared/types"
import { dropPath } from "#shared/links"
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
const notify = useNotify()
const { copy, copied } = useCopy()
const { setShare } = useDropActions()
const moveTo = useMoveDialog()
const folder = computed(() => drop.kind === "folder")
const shared = computed(() => drop.share !== "private")
// Someone else's drop, in Shared with me or a team folder: open it and copy its link; in a team folder, trash it too.
const theirs = computed(() => Boolean(drop.owner))
const { data: me } = useMe()
// The team's folders are the admins' to share.
const changeable = computed(() => !theirs.value && (!drop.teamFolder || me.value?.role === "admin"))
const choices = computed(() => shareItems(me.value, drop))
const status = computed(() => shareStatus(drop, now.value))

const link = useShareUrl(() => drop)
const detail = computed(() => {
  const where = drop.path?.length ? ` · in ${drop.path.map((crumb) => crumb.title).join(" / ")}` : ""
  if (folder.value) return `${itemCount(drop.items ?? 0)}${where}`
  return `${drop.kind === "app" && drop.paths ? `${drop.filename} · ${drop.paths.length} files` : drop.filename}${where}`
})

// The row's share menu shows the new choice, so picking one doesn't toast.
const pick = (next: Share) => next === drop.share || setShare(drop, next)

/** The link button shows a check once it copied; from the menu, which closes, `announce` says it in a toast. */
async function copyLink(announce?: string) {
  // Copying never widens a share on its own: the toast says who each choice lets in, and the team comes first.
  if (!shared.value && changeable.value) {
    const shareAndCopy = (next: Share) => async () => {
      if (await pick(next)) await copy(link.value, { announce: `${SHARED_TITLES[next]}. Link copied` })
    }
    const team = choices.value.some((item) => item.value === "team")
    const canPublic = choices.value.some((item) => item.value === "public")
    notify.info({
      title: "Only you can open this",
      description: team
        ? "Share it with the team, or turn on a public link anyone can open."
        : canPublic
          ? "Turn on a public link to copy it. Anyone with the link can open it."
          : "Share it before you copy its link.",
      actions: [
        ...(team
          ? [
              {
                label: "Share with team & copy",
                color: "neutral" as const,
                variant: "outline" as const,
                onClick: shareAndCopy("team"),
              },
            ]
          : []),
        ...(canPublic
          ? [
              {
                label: "Public link & copy",
                color: "neutral" as const,
                variant: team ? ("ghost" as const) : ("outline" as const),
                onClick: shareAndCopy("public"),
              },
            ]
          : []),
      ],
    })
    return
  }
  await copy(link.value, { announce })
}

const menu = computed(() => [
  [
    { label: "Open", icon: "i-mingcute-eye-2-line", to: `/drops/${drop.id}` },
    {
      label: isPublic(drop.share) ? "Open public page" : "Open shared page",
      icon: "i-mingcute-external-link-line",
      to: dropPath(drop),
      target: "_blank",
      disabled: !shared.value,
    },
    { label: "Copy link", icon: "i-mingcute-link-line", onSelect: () => void copyLink("Link copied") },
  ],
  ...(changeable.value
    ? [
        [
          { label: "Move to folder", icon: "i-mingcute-new-folder-line", onSelect: () => void moveTo({ drop: drop }) },
          { label: "Move to Trash", icon: "i-mingcute-delete-2-line", onSelect: () => emit("delete") },
        ],
      ]
    : theirs.value && inTeam
      ? [[{ label: "Move to Trash", icon: "i-mingcute-delete-2-line", onSelect: () => emit("delete") }]]
      : []),
])
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
      <UIcon :name="open ? 'i-mingcute-folder-open-line' : 'i-mingcute-folder-line'" class="size-[18px]" />
    </button>
    <span
      v-else
      class="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated text-muted ring-1 ring-inset ring-default"
    >
      <UIcon :name="KIND_ICONS[drop.kind]" class="size-[18px]" />
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
      <UButton
        aria-label="Copy link"
        class="hidden sm:inline-flex"
        color="neutral"
        :icon="copied() ? 'i-mingcute-check-line' : 'i-mingcute-link-line'"
        variant="ghost"
        @click="copyLink()"
      />
      <UDropdownMenu :items="menu" :content="{ align: 'end' }">
        <UButton
          :aria-label="`Actions for ${drop.title}`"
          color="neutral"
          icon="i-mingcute-more-1-line"
          variant="ghost"
        />
      </UDropdownMenu>
    </div>
  </li>
</template>
