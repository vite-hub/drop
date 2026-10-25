<script setup lang="ts">
// Who can open a drop is one choice (#shared/share): the list holds only the states this Drop offers for it.
import { isPublic, type Share, SHARE_HINTS, SHARE_ICONS, SHARE_LABELS } from "#shared/share"
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
const days = computed(() => me.value?.publicLinkDays)

// The card above shows the new choice and what it means; only renewing, which may not change what it says, gets a toast.
async function pick(next: Share) {
  const renew = next === own.value
  if ((renew && !isPublic(next)) || !(await setShare(props.drop, next))) return
  if (renew) notify.done("Public link renewed", SHARE_HINTS[next])
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'start', side: 'bottom' }"
    :ui="{
      content:
        'w-[min(24rem,calc(100vw-1rem))] max-h-[min(36rem,calc(100dvh-5rem))] overflow-y-auto overscroll-contain',
    }"
  >
    <UButton
      aria-label="Share drop"
      class="shrink-0"
      color="neutral"
      :icon="SHARE_ICONS[drop.share]"
      label="Share"
      :ui="{ label: 'hidden sm:inline', trailingIcon: 'hidden sm:block' }"
      trailing-icon="i-mingcute-down-small-line"
      size="sm"
      variant="ghost"
    />
    <template #content>
      <div class="p-4">
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 class="text-sm font-medium">Share drop</h2>
          <UButton
            aria-label="Close sharing"
            color="neutral"
            icon="i-mingcute-close-line"
            size="xs"
            variant="ghost"
            @click="open = false"
          />
        </div>
        <p v-if="drop.sharedFrom" class="mb-3 flex items-start gap-2 text-sm text-muted">
          <UIcon name="i-mingcute-folder-line" class="mt-0.5 size-4 shrink-0" />
          <span
            >Shared through {{ drop.sharedFrom.title }} ({{ SHARE_LABELS[drop.share] }}). Its own share below can only
            reach wider.</span
          >
        </p>
        <div class="space-y-3">
          <div v-if="!drop.isOwner || drop.shareReview" class="flex items-center gap-3 rounded-lg bg-elevated p-3">
            <span class="grid size-8 shrink-0 place-items-center rounded-md bg-elevated text-muted"
              ><UIcon :name="SHARE_ICONS[own]" class="size-4"
            /></span>
            <div class="min-w-0">
              <p class="text-sm font-medium text-highlighted">
                {{
                  drop.shareReview === "pending"
                    ? "Waiting for review"
                    : drop.shareReview === "rejected"
                      ? "Share rejected"
                      : shareStatus({ ...drop, share: own })
                }}
              </p>
              <p class="text-xs text-muted">
                {{
                  drop.shareReview
                    ? "An admin reviews public links on this Drop. It still works for you, and for the team on a team Drop."
                    : SHARE_HINTS[own]
                }}
              </p>
            </div>
          </div>
          <URadioGroup
            v-if="drop.isOwner"
            aria-label="Who can open it"
            class="py-1"
            color="neutral"
            :items="choices"
            :model-value="own"
            variant="list"
            @update:model-value="pick"
          />
        </div>
        <p v-if="drop.isOwner && isPublic(own) && days" class="mt-2 text-xs text-muted">
          Public links on this Drop close after {{ days }} {{ days === 1 ? "day" : "days"
          }}{{ me?.mode === "team" ? ", and the team keeps it" : "" }}. Pick it again to start over.
        </p>
        <div class="mt-4 flex items-center gap-1 rounded-md border border-default bg-muted py-1 pr-1 pl-3">
          <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ url }}</span>
          <UButton
            aria-label="Copy link"
            color="neutral"
            :disabled="drop.isOwner && !shared"
            :icon="copied() ? 'i-mingcute-check-line' : 'i-mingcute-copy-2-line'"
            size="sm"
            variant="ghost"
            @click="copy(url)"
          />
        </div>
        <p v-if="shared && !isPublic(drop.share)" class="mt-2 text-xs text-muted">
          Teammates find it under Team. The link asks them to sign in.
        </p>
        <!-- The link stays greyed out while it's only yours; say why instead of leaving a dead button. -->
        <p v-else-if="drop.isOwner && !shared" class="mt-2 text-xs text-muted">
          Choose who can open it to turn the link on.
        </p>
      </div>
    </template>
  </UPopover>
</template>
