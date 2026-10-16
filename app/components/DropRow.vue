<script setup lang="ts">
import type { DropSummary } from "#shared/types"

const props = defineProps<{ drop: DropSummary }>()
const emit = defineEmits<{ delete: []; restore: []; deleteForever: [] }>()
const trashed = computed(() => props.drop.trashedAt !== null)
const notify = useNotify()
const { copy } = useCopy()
const { setVisibility } = useDropActions()
const shared = computed(() => props.drop.visibility === "shared")

const link = useShareUrl(() => props.drop.id)
const detail = computed(() => props.drop.kind === "app" ? `${props.drop.filename} · ${props.drop.paths?.length ?? 0} files` : props.drop.filename)

async function setShared(next: boolean) {
  if (await setVisibility(props.drop, next ? "shared" : "private"))
    notify.done(next ? "Shared" : "Private again", next ? "Anyone with the link can open it." : "Only you can open it.")
}

async function copyLink() {
  if (!shared.value) {
    notify.info({ title: "This drop is private", description: "Share it first so the link works for others.", actions: [{ label: "Share & copy", color: "neutral", variant: "outline", onClick: () => void setShared(true).then(copyLink) }] })
    return
  }
  await copy(link.value, "Link copied")
}

const menu = computed(() => [
  [
    { label: "Open", icon: "i-lucide-eye", to: `/drops/${props.drop.id}` },
    { label: "Open Public Page", icon: "i-lucide-external-link", to: `/d/${props.drop.id}`, target: "_blank", disabled: !shared.value },
    { label: "Copy Link", icon: "i-lucide-link", onSelect: copyLink },
  ],
  [{ label: "Move to Trash", icon: "i-lucide-trash", onSelect: () => emit("delete") }],
])
</script>

<template>
  <li class="group relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-3 transition-colors hover:bg-muted md:grid-cols-[auto_minmax(0,1fr)_8.5rem_6.5rem_auto]">
    <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated text-muted ring-1 ring-inset ring-default">
      <UIcon :name="KIND_ICONS[drop.kind]!" class="size-[18px]" />
    </span>
    <div class="min-w-0">
      <NuxtLink class="flex min-w-0 items-center gap-2 after:absolute after:inset-0" :to="`/drops/${drop.id}`">
        <span class="truncate font-medium text-highlighted">{{ drop.title }}</span>
        <UBadge v-if="drop.version > 1" class="hidden sm:inline-flex" color="neutral" icon="i-lucide-history" :label="`v${drop.version}`" size="sm" variant="outline" />
        <ExpiryBadge class="shrink-0" :drop="drop" />
      </NuxtLink>
      <p class="mt-0.5 truncate font-mono text-xs text-muted">
        <span class="hidden sm:inline">{{ detail }} · </span>{{ formatBytes(drop.size) }}<span class="md:hidden"> · <TimeAgo :at="drop.updatedAt" /></span>
      </p>
    </div>
    <div class="hidden min-w-0 md:block">
      <span class="flex min-w-0 items-center gap-1.5 text-[13px] text-highlighted" :title="drop.actorName">
        <AgentIcon class="size-3.5" :kind="drop.actorKind" :name="drop.actorName" />
        <span class="truncate">{{ drop.actorName }}</span>
      </span>
      <span class="mt-0.5 block text-xs text-muted tabular-nums"><TimeAgo :at="drop.updatedAt" /></span>
    </div>
    <span v-if="trashed" class="hidden text-[13px] text-muted md:block">{{ drop.trashReason === "expired" ? "Expired" : "Deleted" }}</span>
    <label v-else class="relative z-10 hidden items-center gap-2.5 md:flex">
      <USwitch :model-value="shared" color="neutral" :aria-label="shared ? 'Make private' : 'Share'" @update:model-value="setShared" />
      <span class="text-[13px]" :class="shared ? 'text-highlighted' : 'text-muted'">{{ drop.quarantinedAt ? "Quarantined" : drop.shareReview === "pending" ? "Pending review" : drop.shareReview === "rejected" ? "Rejected" : shared ? "Shared" : "Private" }}</span>
    </label>
    <div v-if="trashed" class="relative z-10 flex items-center gap-1">
      <UButton color="neutral" icon="i-lucide-undo-2" label="Restore" size="sm" variant="outline" @click="emit('restore')" />
      <UButton :aria-label="`Delete ${drop.title} for good`" color="error" icon="i-lucide-trash-2" size="sm" variant="ghost" @click="emit('deleteForever')" />
    </div>
    <div v-else class="relative z-10 flex items-center gap-0.5">
      <USwitch class="md:hidden" :model-value="shared" color="neutral" :aria-label="shared ? 'Make private' : 'Share'" @update:model-value="setShared" />
      <UButton aria-label="Copy link" class="hidden sm:inline-flex" color="neutral" icon="i-lucide-link" variant="ghost" @click="copyLink" />
      <UDropdownMenu :items="menu" :content="{ align: 'end' }">
        <UButton :aria-label="`Actions for ${drop.title}`" color="neutral" icon="i-lucide-ellipsis" variant="ghost" />
      </UDropdownMenu>
    </div>
  </li>
</template>
