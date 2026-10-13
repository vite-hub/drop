<script setup lang="ts">
// Only what needs attention: an expired drop, one about to expire, or an agent waiting for "Never expires".
// Grayscale until it has expired; red is reserved for that.
import { DAY_MS, daysUntil, deletesAt } from "#shared/expiry"
import type { DropSummary } from "#shared/types"

const props = defineProps<{ drop: Pick<DropSummary, "expiresAt" | "neverExpires" | "neverExpiresRequest"> }>()
const now = useRelativeNow()
const badge = computed(() => {
  const { expiresAt, neverExpires, neverExpiresRequest } = props.drop
  if (neverExpires || expiresAt === null) return null
  if (expiresAt <= now.value) return { label: `Expired · ${daysUntil(deletesAt(expiresAt), now.value)}d`, title: "Expired. Renew it before it's deleted.", expired: true }
  if (neverExpiresRequest) return { label: "Keep forever?", title: `${neverExpiresRequest} asked to keep this drop forever.`, expired: false }
  if (expiresAt - now.value <= 7 * DAY_MS) return { label: `${daysUntil(expiresAt, now.value)}d left`, title: "Expires unless someone opens it.", expired: false }
  return null
})
</script>

<template>
  <UBadge
    v-if="badge"
    class="font-mono tabular-nums"
    :class="!badge.expired && 'text-highlighted'"
    :color="badge.expired ? 'error' : 'neutral'"
    :label="badge.label"
    size="sm"
    :title="badge.title"
    :variant="badge.expired ? 'subtle' : 'outline'"
  />
</template>
