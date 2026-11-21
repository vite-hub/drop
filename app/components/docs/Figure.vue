<script setup lang="ts">
defineProps<{ src?: string; alt?: string; width?: number; height?: number }>()
</script>

<template>
  <figure class="not-prose my-5 overflow-hidden rounded-xl border border-default bg-muted">
    <img
      v-if="src"
      :src="src"
      :alt="alt"
      :width="width"
      :height="height"
      loading="lazy"
      decoding="async"
      class="block h-auto w-full"
    />
    <div v-else class="p-3 sm:p-6">
      <slot />
    </div>
  </figure>
</template>
