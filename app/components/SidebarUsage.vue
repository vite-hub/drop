<script setup lang="ts">
// How much of the plan the drops use, at the foot of the sidebar: storage, drops, and file writes. Shown only
// where a plan sets limits. Near or at a limit the bar darkens to a warning and offers your own Drop, which has none.
import { MIB, usageNearLimit } from "#shared/quotas"

const { data: usage } = useUsage()
const limited = computed(
  () =>
    usage.value?.enabled &&
    [usage.value.drops, usage.value.bytes, usage.value.writes].some((quota) => quota.limit !== null),
)
const near = computed(() => Boolean(usage.value && usageNearLimit(usage.value)))
const reached = computed(() => {
  const value = usage.value
  return Boolean(
    value &&
    [value.drops, value.bytes, value.writes].some((quota) => quota.limit !== null && quota.used >= quota.limit),
  )
})
const of = (quota: { used: number; limit: number | null }) => `${quota.used} of ${quota.limit ?? "∞"}`
const mib = (bytes: number) => Math.ceil((bytes / MIB) * 10) / 10
const storage = computed(() => {
  const bytes = usage.value?.bytes
  if (!bytes) return ""
  const limit =
    bytes.limit === null
      ? "∞"
      : bytes.limit >= 1024 * MIB
        ? `${bytes.limit / (1024 * MIB)} GiB`
        : `${mib(bytes.limit)} MiB`
  return `${mib(bytes.used)} MiB of ${limit}`
})
const share = computed(() => {
  const bytes = usage.value?.bytes
  return bytes?.limit ? Math.min(100, (bytes.used / bytes.limit) * 100) : 0
})
const title = computed(() => {
  const value = usage.value
  if (!value) return ""
  return `${of(value.drops)} drops, ${storage.value}, ${of(value.writes)} file writes this month`
})
</script>

<template>
  <div v-if="usage && limited" class="flex flex-col gap-1.5 px-2 pt-1 pb-2 text-xs" :title="title">
    <div class="flex items-center justify-between gap-2">
      <span class="text-muted">Storage</span>
      <span class="text-highlighted tabular-nums">{{ storage }}</span>
    </div>
    <div
      aria-label="Storage used"
      :aria-valuenow="Math.round(share)"
      aria-valuemax="100"
      aria-valuemin="0"
      class="h-1 overflow-hidden rounded-full bg-accented"
      role="progressbar"
    >
      <div class="h-full rounded-full" :class="near ? 'bg-warning' : 'bg-inverted'" :style="{ width: `${share}%` }" />
    </div>
    <div v-if="usage.drops.limit !== null" class="flex items-center justify-between gap-2 text-muted">
      <span>Drops</span>
      <span class="tabular-nums">{{ usage.drops.used }} / {{ usage.drops.limit }}</span>
    </div>
    <div class="flex items-center justify-between gap-2 text-muted">
      <span>Writes this month</span>
      <span class="tabular-nums">{{ usage.writes.used }} / {{ usage.writes.limit ?? "∞" }}</span>
    </div>
    <ULink v-if="near" class="text-highlighted underline underline-offset-2" :to="usage.selfHostUrl" external>
      {{ reached ? "Plan limit reached." : "Near your plan's limit." }} Deploy your own
    </ULink>
  </div>
</template>
