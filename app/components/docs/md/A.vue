<script setup lang="ts">
defineProps<{ href: string }>()
</script>

<template>
  <NuxtLink :to="href"><slot /></NuxtLink>
</template>
