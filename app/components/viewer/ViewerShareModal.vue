<script setup lang="ts">
import { type Access, ACCESS_HINTS, ACCESS_LABELS, type DropDetail, type Visibility, VISIBILITY_HINTS, VISIBILITY_ICONS, VISIBILITY_LABELS } from "#shared/types"

const props = defineProps<{ drop: DropDetail }>()
const open = defineModel<boolean>("open", { default: false })
const notify = useNotify()
const { setVisibility } = useDropActions()
const { copy, copied } = useCopy()
const shared = computed(() => props.drop.visibility !== "private")
const url = useShareUrl(() => props.drop)
const audiences = (Object.keys(VISIBILITY_LABELS) as Visibility[]).map(value => ({ value, label: VISIBILITY_LABELS[value], icon: VISIBILITY_ICONS[value] }))
// Only Markdown docs have the live editor, so only they offer "Can edit".
const levels = computed(() => (Object.keys(ACCESS_LABELS) as Access[])
  .filter(value => value !== "edit" || props.drop.kind === "markdown" || props.drop.access === "edit")
  .map(value => ({ value, label: ACCESS_LABELS[value], description: ACCESS_HINTS[value] })))

async function setAudience(next: Visibility) {
  if (next === props.drop.visibility) return
  // Sharing a private Markdown doc with the team means working on it together, so it opens for editing.
  const access = next === "team" && !shared.value && props.drop.kind === "markdown" ? "edit" : undefined
  if (await setVisibility(props.drop, next, access)) notify.done(next === "private" ? "Private again" : "Share updated")
}
async function setAccess(level: Access) {
  if (level !== props.drop.access && await setVisibility(props.drop, props.drop.visibility, level)) notify.done("Share access updated")
}
</script>

<template>
  <UModal v-model:open="open" :description="drop.title" title="Share drop">
    <template #body>
      <div class="divide-y divide-default rounded-lg border border-default">
        <div class="flex items-center justify-between gap-3 p-3">
          <div class="flex min-w-0 items-center gap-3">
            <span class="grid size-8 shrink-0 place-items-center rounded-md bg-elevated text-muted"><UIcon :name="VISIBILITY_ICONS[drop.visibility]" class="size-4" /></span>
            <div class="min-w-0">
              <p class="text-sm font-medium text-highlighted">{{ drop.shareReview === "pending" ? "Waiting for review" : drop.shareReview === "rejected" ? "Share rejected" : VISIBILITY_LABELS[drop.visibility] }}</p>
              <p class="text-xs text-muted">{{ drop.shareReview ? "You can still use this drop privately." : VISIBILITY_HINTS[drop.visibility] }}</p>
            </div>
          </div>
          <USelect
            aria-label="Who can open it"
            class="w-48 shrink-0"
            color="neutral"
            :icon="VISIBILITY_ICONS[drop.visibility]"
            :items="audiences"
            :model-value="drop.visibility"
            @update:model-value="setAudience"
          />
        </div>
        <URadioGroup v-if="shared" aria-label="Share access" class="p-3" color="neutral" :items="levels" :model-value="drop.access" variant="card" @update:model-value="setAccess" />
      </div>
      <div class="mt-4 flex items-center gap-1 rounded-md border border-default bg-muted py-1 pr-1 pl-3" :class="!shared && 'opacity-50'">
        <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ url }}</span>
        <UButton aria-label="Copy link" color="neutral" :disabled="!shared" :icon="copied ? 'i-ph-check' : 'i-ph-copy'" size="sm" variant="ghost" @click="copy(url, 'Link copied')" />
      </div>
      <p v-if="drop.visibility === 'team'" class="mt-2 text-xs text-muted">Teammates find it under Shared with me. The link asks them to sign in.</p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end"><UButton color="neutral" label="Done" @click="open = false" /></div>
    </template>
  </UModal>
</template>
