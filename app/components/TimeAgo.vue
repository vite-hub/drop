<script setup lang="ts">
// "3 min. ago" against the page's one shared clock (useRelativeNow): the server's text is reused on hydration, and
// a list of rows runs one timer, not one per row as <NuxtTime relative> would. Hovering shows the full date.
const props = defineProps<{ at: number | string | Date }>()
const now = useRelativeNow()
const format = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" })
const UNITS = [["second", 60], ["minute", 60], ["hour", 24], ["day", 30], ["month", 12], ["year", Infinity]] as const
const SECONDS = { second: 1, minute: 60, hour: 3600, day: 86400, month: 2592000, year: 31536000 }

const date = computed(() => new Date(props.at))
const text = computed(() => {
  const seconds = (date.value.getTime() - now.value) / 1000
  const [unit] = UNITS.find(([unit, limit]) => Math.abs(seconds / SECONDS[unit]) < limit)!
  return format.format(Math.round(seconds / SECONDS[unit]), unit)
})
</script>

<template>
  <time :datetime="date.toISOString()" :title="date.toISOString()">{{ text }}</time>
</template>
