<script setup lang="ts">
// A section heading that links to itself. Pages set the id with `## Title {#id}` so links keep working when titles change.
defineProps<{ id?: string }>()
</script>

<template>
  <h2 :id="id" class="scroll-mt-20">
    <a v-if="id" :href="`#${id}`" class="no-underline"><slot /></a>
    <slot v-else />
  </h2>
</template>
