<script setup lang="ts">
// Links in the docs' Markdown: other pages through the router, everything else as a plain link.
defineProps<{ href: string }>()
</script>

<template>
  <NuxtLink :to="href"><slot /></NuxtLink>
</template>
