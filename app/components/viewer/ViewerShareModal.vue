<script setup lang="ts">
import { type Access, ACCESS_HINTS, ACCESS_LABELS, type DropDetail } from "#shared/types"

const props = defineProps<{ drop: DropDetail }>()
const open = defineModel<boolean>("open", { default: false })
const notify = useNotify()
const { setVisibility } = useDropActions()
const { copy, copied } = useCopy()
const shared = computed(() => props.drop.visibility === "shared")
const url = computed(() => (import.meta.client ? `${location.origin}/d/${props.drop.id}` : `/d/${props.drop.id}`))
const levels = Object.keys(ACCESS_LABELS) as Access[]

async function setShared(next: boolean) {
  if (await setVisibility(props.drop, next ? "shared" : "private")) notify.done(next ? "Shared" : "Private again")
}
async function setAccess(level: Access) {
  if (level !== props.drop.access && await setVisibility(props.drop, "shared", level)) notify.done(`Anyone with the link ${ACCESS_LABELS[level].toLowerCase()}`)
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
              <p class="text-sm font-medium text-highlighted">{{ shared ? "Anyone with the link" : "Only you" }}</p>
              <p class="text-xs text-muted">{{ shared ? "No sign-in needed." : "Agents with your key can still read it." }}</p>
            </div>
          </div>
          <USwitch
            aria-label="Share with anyone with the link"
            color="neutral"
            :model-value="shared"
            @update:model-value="setShared"
          />
        </div>
        <div v-if="shared" class="space-y-1 p-2" role="radiogroup">
          <button
            v-for="level in levels"
            :key="level"
            :aria-checked="drop.access === level"
            class="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-elevated"
            :class="drop.access === level && 'bg-elevated'"
            role="radio"
            type="button"
            @click="setAccess(level)"
          >
            <span class="grid size-4 shrink-0 place-items-center rounded-full border" :class="drop.access === level ? 'border-(--ui-text-highlighted)' : 'border-default'">
              <span v-if="drop.access === level" class="size-2 rounded-full bg-inverted" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-highlighted">{{ ACCESS_LABELS[level] }}</span>
              <span class="block text-xs text-muted">{{ ACCESS_HINTS[level] }}</span>
            </span>
          </button>
        </div>
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
