<script setup lang="ts">
// Only what needs attention: a drop in the Trash, one about to expire, or a temporary one.
// Grayscale until it's in the Trash; red is reserved for that.
import { DAY_MS, daysUntil, purgesAt } from "#shared/expiry"
import type { DropSummary } from "#shared/types"

const props = defineProps<{ drop: Pick<DropSummary, "expiresAt" | "lifetime" | "trashedAt"> }>()
const now = useRelativeNow()
const badge = computed(() => {
  const { expiresAt, lifetime, trashedAt } = props.drop
  if (trashedAt !== null) return { label: `Trash · ${daysUntil(purgesAt(trashedAt), now.value)}d`, title: "In the Trash. Restore it before it's deleted.", trashed: true }
  if (expiresAt === null) return null
  if (expiresAt - now.value <= 7 * DAY_MS) return { label: `${daysUntil(expiresAt, now.value)}d left`, title: "Goes to the Trash unless someone opens it.", trashed: false }
  if (lifetime === "temporary") return { label: "Temporary", title: "Goes to the Trash 14 days after the last visit.", trashed: false }
  return null
})
</script>

<template>
  <UBadge
    v-if="badge"
    class="font-mono tabular-nums"
    :class="!badge.trashed && 'text-highlighted'"
    :color="badge.trashed ? 'error' : 'neutral'"
    :label="badge.label"
    size="sm"
    :title="badge.title"
    :variant="badge.trashed ? 'subtle' : 'outline'"
  />
</template>
