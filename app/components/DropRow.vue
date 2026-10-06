<script setup lang="ts">
import type { DropSummary } from "#shared/types"

const props = defineProps<{ drop: DropSummary }>()
const emit = defineEmits<{ delete: [] }>()
const toast = useToast()
const { copy } = useCopy()
const { setVisibility } = useDropActions()
const shared = computed(() => props.drop.visibility === "shared")

const link = computed(() => (import.meta.client ? `${location.origin}/d/${props.drop.id}` : `/d/${props.drop.id}`))
const detail = computed(() => props.drop.kind === "app" ? `${props.drop.filename} · ${props.drop.paths?.length ?? 0} files` : props.drop.filename)

async function setShared(next: boolean) {
  if (await setVisibility(props.drop, next ? "shared" : "private"))
    toast.add({ title: next ? "Shared" : "Private again", description: next ? "Anyone with the link can comment." : "Only you can open it." })
}

async function copyLink() {
  if (!shared.value) {
    toast.add({ title: "This drop is private", description: "Share it first so the link works for others.", actions: [{ label: "Share & copy", color: "neutral", variant: "outline", onClick: () => void setShared(true).then(copyLink) }] })
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
  [{ label: "Delete Drop", icon: "i-lucide-trash", color: "error" as const, onSelect: () => emit("delete") }],
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
    <label class="relative z-10 hidden items-center gap-2.5 md:flex">
      <USwitch :model-value="shared" color="neutral" :aria-label="shared ? 'Make private' : 'Share'" @update:model-value="setShared" />
      <span class="text-[13px]" :class="shared ? 'text-highlighted' : 'text-muted'">{{ shared ? "Shared" : "Private" }}</span>
    </label>
    <div class="relative z-10 flex items-center gap-0.5">
      <USwitch class="md:hidden" :model-value="shared" color="neutral" :aria-label="shared ? 'Make private' : 'Share'" @update:model-value="setShared" />
      <UButton aria-label="Copy link" class="hidden sm:inline-flex" color="neutral" icon="i-lucide-link" variant="ghost" @click="copyLink" />
      <UDropdownMenu :items="menu" :content="{ align: 'end' }">
        <UButton :aria-label="`Actions for ${drop.title}`" color="neutral" icon="i-lucide-ellipsis" variant="ghost" />
      </UDropdownMenu>
    </div>
  </li>
</template>
