<script setup lang="ts">
defineProps<{ id: string; title: string }>()
</script>

<template>
  <section :id="id" class="scroll-mt-8 border-t border-default pt-8 first:border-t-0 first:pt-0">
    <h2 class="text-lg font-medium tracking-tight text-highlighted">{{ title }}</h2>
    <div class="mt-3 space-y-3 text-sm leading-relaxed text-muted [&_strong]:font-medium [&_strong]:text-highlighted">
      <slot />
    </div>
  </section>
</template>
