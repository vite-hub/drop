<script setup lang="ts">
// A screenshot in the docs, framed like a window of the app; or, with the default slot, a landing story in its place.
// The Markdown version of the page leaves figures out (server/utils/html-markdown.ts): the words around them say it.
defineProps<{ src?: string; alt?: string; width?: number; height?: number }>()
</script>

<template>
  <figure class="not-prose my-5 overflow-hidden rounded-xl border border-default bg-muted">
    <img v-if="src" :src="src" :alt="alt" :width="width" :height="height" loading="lazy" decoding="async" class="block h-auto w-full">
    <div v-else class="p-3 sm:p-6">
      <slot />
    </div>
  </figure>
</template>
