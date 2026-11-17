<script setup lang="ts">
// "3 min. ago" against the page's one shared clock (useRelativeNow, timeAgo): the server's text is reused on hydration,
// and a list of rows runs one timer, not one per row as <NuxtTime relative> would. Hovering shows the full date.
const props = defineProps<{ at: number | string | Date }>()
const now = useRelativeNow()

const date = computed(() => new Date(props.at))
const text = computed(() => timeAgo(date.value, now.value))
</script>

<template>
  <time :datetime="date.toISOString()" :title="date.toISOString()">{{ text }}</time>
</template>
