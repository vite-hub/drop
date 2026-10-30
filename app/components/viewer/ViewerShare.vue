<script setup lang="ts">
// Who can open a drop is one choice (#shared/share). Every state stays in the list, and one this drop can't take says
// why, so picking never makes options appear or vanish; the line under the link always takes one line, so the popover
// keeps its height too.
import { daysUntil } from "#shared/expiry"
import { isPublic, type Share, SHARE_ICONS, SHARE_LABELS } from "#shared/share"
import type { DropDetail } from "#shared/types"

const props = defineProps<{ drop: DropDetail }>()
const open = defineModel<boolean>("open", { default: false })
const notify = useNotify()
const { setShare } = useDropActions()
const { copy, copied } = useCopy()
const { data: me } = useMe()
const shared = computed(() => props.drop.share !== "private")
// A folder above may share it wider than its own share; the choice changes its own.
const own = computed<Share>(() => props.drop.ownShare ?? props.drop.share)
const url = useShareUrl(() => props.drop)
const choices = computed(() => shareItems(me.value, props.drop))
const now = useRelativeNow()

// What the link does now, in one line.
const linkNote = computed(() => {
  if (props.drop.isOwner && !shared.value) return "Pick who can open it to turn the link on."
  if (!isPublic(props.drop.share)) return "Teammates sign in to open it."
  if (!props.drop.publicUntil) return "It stays open until you change it."
  const left = daysUntil(props.drop.publicUntil, now.value)
  const after = me.value?.mode === "team" || props.drop.team ? "the team" : "only you"
  return `Back to ${after} in ${left} ${left === 1 ? "day" : "days"}.${props.drop.isOwner ? " Pick it again to renew." : ""}`
})

// The list shows the new choice and what it means; only renewing, which may not change what it says, gets a note.
async function pick(next: Share) {
  const renew = next === own.value
  if ((renew && !isPublic(next)) || !(await setShare(props.drop, next))) return
  if (renew) notify.done("Public link renewed")
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'end', side: 'top' }"
    :ui="{
      content:
        'w-[min(23rem,calc(100vw-1rem))] max-h-[min(36rem,calc(100dvh-5rem))] overflow-y-auto overscroll-contain rounded-[12px] border border-default surface-review bg-(--review-surface) ring-0',
    }"
  >
    <UButton
      aria-label="Share drop"
      class="shrink-0"
      color="neutral"
      :icon="SHARE_ICONS[drop.share]"
      label="Share"
      size="xs"
      variant="ghost"
    />
    <template #content>
      <div class="flex flex-col gap-3 p-3">
        <div class="flex items-center justify-between gap-2 pl-1">
          <h2 class="text-sm font-medium text-highlighted">Share drop</h2>
          <UButton
            aria-label="Close sharing"
            color="neutral"
            icon="i-mingcute-close-line"
            size="xs"
            variant="ghost"
            @click="open = false"
          />
        </div>
        <p v-if="drop.sharedFrom" class="flex items-start gap-2 px-1 text-xs text-muted">
          <UIcon name="i-mingcute-folder-line" class="mt-px size-4 shrink-0" />
          <span
            >Shared through {{ drop.sharedFrom.title }} ({{ SHARE_LABELS[drop.share] }}). Its own share can only reach
            wider.</span
          >
        </p>
        <div v-if="drop.shareReview" class="flex items-start gap-2.5 rounded-lg bg-elevated p-2.5">
          <UIcon name="i-mingcute-time-line" class="mt-px size-4 shrink-0 text-muted" />
          <div class="min-w-0 text-xs">
            <p class="font-medium text-highlighted">
              {{ drop.shareReview === "pending" ? "Waiting for review" : "Share rejected" }}
            </p>
            <p class="text-muted">
              An admin reviews public links on this Drop. It still works for you, and for the team on a team Drop.
            </p>
          </div>
        </div>
        <p v-if="!drop.isOwner" class="px-1 text-xs text-muted">Only its owner changes who can open it.</p>
        <URadioGroup
          aria-label="Who can open it"
          color="neutral"
          :disabled="!drop.isOwner"
          :items="choices"
          :model-value="own"
          size="sm"
          :ui="{
            fieldset: 'gap-0',
            item: 'rounded-md px-1 py-1.5 has-[button:enabled]:hover:bg-elevated/60 motion-safe:transition-colors motion-safe:duration-150',
            wrapper: 'min-w-0',
            label: 'flex items-center gap-1.5 font-medium',
            description: 'text-xs',
          }"
          variant="list"
          @update:model-value="pick"
        >
          <template #label="{ item }">
            <UIcon aria-hidden="true" class="size-4 shrink-0 text-muted" :name="item.icon" />{{ item.label }}
          </template>
        </URadioGroup>
        <div>
          <div class="flex items-center gap-1 rounded-md border border-default bg-muted py-1 pr-1 pl-3">
            <span
              class="min-w-0 flex-1 truncate font-mono text-xs"
              :class="{ 'text-dimmed': drop.isOwner && !shared }"
              >{{ url }}</span
            >
            <UButton
              :aria-label="copied() ? 'Link copied' : 'Copy link'"
              color="neutral"
              :disabled="drop.isOwner && !shared"
              :icon="copied() ? 'i-mingcute-check-line' : 'i-mingcute-copy-2-line'"
              size="sm"
              variant="ghost"
              @click="copy(url)"
            />
          </div>
          <p aria-live="polite" class="mt-1.5 min-h-lh px-1 text-xs text-muted">{{ linkNote }}</p>
        </div>
      </div>
    </template>
  </UPopover>
</template>
