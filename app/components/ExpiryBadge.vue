<script setup lang="ts">
// Only what needs attention: a drop in the Trash, or one that goes there within two weeks unless someone opens it.
// Grayscale until it's in the Trash; red is reserved for that.
import { DAY_MS, daysUntil, purgesAt, TEMPORARY_DAYS } from "#shared/expiry"
import type { DropSummary } from "#shared/types"

const props = defineProps<{ drop: Pick<DropSummary, "expiresAt" | "trashedAt"> }>()
const now = useRelativeNow()
const badge = computed(() => {
  const { expiresAt, trashedAt } = props.drop
  if (trashedAt !== null) {
    const left = daysUntil(purgesAt(trashedAt), now.value)
    return {
      label: `Trash · ${left}d`,
      title: `In the Trash. Deleted for good in ${left} ${left === 1 ? "day" : "days"} unless you restore it.`,
      trashed: true,
    }
  }
  if (expiresAt === null || expiresAt - now.value > TEMPORARY_DAYS * DAY_MS) return null
  const left = daysUntil(expiresAt, now.value)
  return {
    label: `${left}d left`,
    title: `Goes to the Trash in ${left} ${left === 1 ? "day" : "days"} unless someone opens it.`,
    trashed: false,
  }
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
