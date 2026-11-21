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
// One fixed locale, so the server and the browser print the same digits.
const count = new Intl.NumberFormat("en-US")
const of = (quota: { used: number; limit: number | null }) =>
  `${count.format(quota.used)} / ${quota.limit === null ? "∞" : count.format(quota.limit)}`
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
  return `${mib(bytes.used)} MiB / ${limit}`
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
  <!-- Neither a label nor a value ever breaks. When a row is too narrow for both, the value moves under its label, still on
       the right edge with the other values. -->
  <div v-if="usage && limited" class="flex flex-col gap-1.5 px-2 pt-1 pb-2 text-xs" :title="title">
    <div class="flex flex-wrap items-baseline justify-between gap-x-3">
      <span class="whitespace-nowrap text-muted">Storage</span>
      <span class="ml-auto whitespace-nowrap text-highlighted tabular-nums">{{ storage }}</span>
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
    <div v-if="usage.drops.limit !== null" class="flex flex-wrap items-baseline justify-between gap-x-3">
      <span class="whitespace-nowrap text-muted">Drops</span>
      <span class="ml-auto whitespace-nowrap text-highlighted tabular-nums">{{ of(usage.drops) }}</span>
    </div>
    <div class="flex flex-wrap items-baseline justify-between gap-x-3">
      <span class="whitespace-nowrap text-muted">Writes this month</span>
      <span class="ml-auto whitespace-nowrap text-highlighted tabular-nums">{{ of(usage.writes) }}</span>
    </div>
    <p v-if="near" class="mt-1 text-pretty text-muted">
      {{ reached ? "Plan limit reached." : "Near your plan's limit." }}
      <ULink
        class="whitespace-nowrap text-highlighted underline decoration-1 underline-offset-2 hover:decoration-2"
        :to="usage.selfHostUrl"
        external
        >Deploy your own</ULink
      >
    </p>
  </div>
</template>
