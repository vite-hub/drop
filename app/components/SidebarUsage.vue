<script setup lang="ts">
// How much of the plan the drops use, at the foot of the sidebar: storage, drops, and file writes. Shown only
// where a plan sets limits. Each limited quota gets its own bar, which turns to a warning near its limit, and near
// any limit the block offers your own Drop, which has none.
//
// The sidebar is 15rem by default and 12rem at its narrowest, which leaves 208px and 160px here. Short labels keep
// each label and value on one row at both; a value that still doesn't fit moves under its label.
import { MIB, quotaNearLimit, usageNearLimit } from "#shared/quotas"

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
const amount = (n: number | null) => (n === null ? "∞" : count.format(n))
const mib = (bytes: number) => Math.ceil((bytes / MIB) * 10) / 10
const size = (bytes: number | null) =>
  bytes === null ? "∞" : bytes >= 1024 * MIB ? `${bytes / (1024 * MIB)} GiB` : `${mib(bytes)} MiB`

const rows = computed(() => {
  const value = usage.value
  if (!value) return []
  const row = (kind: "drops" | "bytes" | "writes", label: string, text: string, title: string) => {
    const { used, limit } = value[kind]
    return {
      kind,
      label,
      text,
      title,
      share: limit ? Math.min(100, (used / limit) * 100) : null,
      near: quotaNearLimit(kind, value[kind]),
    }
  }
  return [
    row("bytes", "Storage", `${mib(value.bytes.used)} MiB / ${size(value.bytes.limit)}`, "Storage used"),
    ...(value.drops.limit === null
      ? []
      : [row("drops", "Drops", `${amount(value.drops.used)} / ${amount(value.drops.limit)}`, "Drops")]),
    row(
      "writes",
      "Writes",
      `${amount(value.writes.used)} / ${amount(value.writes.limit)}`,
      "File writes this month. They start over on the 1st (UTC).",
    ),
  ]
})
</script>

<template>
  <div v-if="usage && limited" class="flex flex-col gap-2.5 px-2 pt-1 pb-2 text-xs">
    <div v-for="row in rows" :key="row.kind" class="flex flex-col gap-1" :title="row.title">
      <div class="flex flex-wrap items-baseline justify-between gap-x-2">
        <span class="whitespace-nowrap text-muted">{{ row.label }}</span>
        <span class="ml-auto whitespace-nowrap text-highlighted tabular-nums">{{ row.text }}</span>
      </div>
      <div
        v-if="row.share !== null"
        :aria-label="`${row.label} used`"
        :aria-valuenow="Math.round(row.share)"
        aria-valuemax="100"
        aria-valuemin="0"
        class="h-1 overflow-hidden rounded-full bg-accented"
        role="progressbar"
      >
        <div
          class="h-full rounded-full"
          :class="row.near ? 'bg-warning' : 'bg-inverted'"
          :style="{ width: `${row.share}%` }"
        />
      </div>
    </div>
    <p v-if="near" class="text-pretty text-muted">
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
