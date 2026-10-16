<script setup lang="ts">
// Someone else's caret in a live doc: a line in their presence color with their name over it (main.css .live-caret).
defineProps<{ name: string; color: string }>()
</script>

<template>
  <span class="relative mx-px inline-block h-[1.15em] w-[2px] translate-y-[0.2em] rounded-full" :style="{ background: color }">
    <span class="absolute bottom-full -left-px rounded-t-sm rounded-br-sm px-1 py-px text-[10px] leading-tight font-medium whitespace-nowrap text-white" :style="{ background: color }">{{ name }}</span>
  </span>
</template>
