<script setup lang="ts">
// "3 min. ago", via Nuxt's <NuxtTime>: the server's text is reused on hydration, then it keeps itself current.
// Hovering shows the full date.
defineProps<{ at: number | string | Date }>()
</script>

<template>
  <NuxtTime :datetime="at" locale="en" numeric="auto" relative relative-style="short" title />
</template>
