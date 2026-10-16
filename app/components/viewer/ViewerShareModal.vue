<script setup lang="ts">
import { type Access, ACCESS_HINTS, ACCESS_LABELS, type DropDetail } from "#shared/types"

const props = defineProps<{ drop: DropDetail }>()
const open = defineModel<boolean>("open", { default: false })
const notify = useNotify()
const { setVisibility } = useDropActions()
const { copy, copied } = useCopy()
const shared = computed(() => props.drop.visibility === "shared")
const url = computed(() => (import.meta.client ? `${location.origin}/d/${props.drop.id}` : `/d/${props.drop.id}`))
// Only Markdown docs have the live editor, so only they offer "Can edit".
const levels = computed(() => (Object.keys(ACCESS_LABELS) as Access[])
  .filter(value => value !== "edit" || props.drop.kind === "markdown" || props.drop.access === "edit")
  .map(value => ({ value, label: ACCESS_LABELS[value], description: ACCESS_HINTS[value] })))

async function setShared(next: boolean) {
  if (await setVisibility(props.drop, next ? "shared" : "private")) notify.done(next ? "Share updated" : "Private again")
}
async function setAccess(level: Access) {
  if (level !== props.drop.access && await setVisibility(props.drop, "shared", level)) notify.done("Share access updated")
}
</script>

<template>
  <UModal v-model:open="open" :description="drop.title" title="Share drop">
    <template #body>
      <div class="divide-y divide-default rounded-lg border border-default">
        <div class="flex items-center justify-between gap-3 p-3">
          <div class="flex items-center gap-3">
            <span class="grid size-8 place-items-center rounded-md bg-elevated text-muted"><UIcon :name="shared ? 'i-lucide-globe' : 'i-lucide-lock'" class="size-4" /></span>
            <div>
              <p class="text-sm font-medium text-highlighted">{{ drop.shareReview === "pending" ? "Waiting for review" : drop.shareReview === "rejected" ? "Share rejected" : shared ? "Anyone with the link" : "Only you" }}</p>
              <p class="text-xs text-muted">{{ drop.shareReview ? "You can still use this drop privately." : shared ? "No sign-in needed." : "Your connected agents can still read it." }}</p>
            </div>
          </div>
          <USwitch
            aria-label="Share with anyone with the link"
            color="neutral"
            :model-value="shared"
            @update:model-value="setShared"
          />
        </div>
        <URadioGroup v-if="shared" aria-label="Share access" class="p-3" color="neutral" :items="levels" :model-value="drop.access" variant="card" @update:model-value="setAccess" />
      </div>
      <div class="mt-4 flex items-center gap-1 rounded-md border border-default bg-muted py-1 pr-1 pl-3" :class="!shared && 'opacity-50'">
        <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ url }}</span>
        <UButton aria-label="Copy link" color="neutral" :disabled="!shared" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" size="sm" variant="ghost" @click="copy(url, 'Link copied')" />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end"><UButton color="neutral" label="Done" @click="open = false" /></div>
    </template>
  </UModal>
</template>
