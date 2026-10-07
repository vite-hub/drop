<script setup lang="ts">
defineProps<{ id: string; title: string }>()
</script>

<template>
  <section :id="id" class="scroll-mt-20">
    <h2 class="group text-lg font-semibold tracking-tight text-highlighted">
      <a :href="`#${id}`" class="no-underline">{{ title }}</a>
    </h2>
    <div class="docs-prose mt-3">
      <slot />
    </div>
  </section>
</template>
