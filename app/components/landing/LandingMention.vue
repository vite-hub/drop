<script setup lang="ts">
// A named product inside running text, with its logo, as a small link pill (antfu.me's style).
defineProps<{ name: string; icon: string; href: string; color?: string }>()
</script>

<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener"
    class="mx-px inline-flex items-center gap-1.5 rounded-md bg-elevated px-1.5 align-[-0.15em] leading-[1.5] whitespace-nowrap text-toned ring-1 ring-(--ui-border) transition-colors ring-inset hover:bg-accented hover:text-highlighted"
    ><UIcon :name="icon" class="size-[0.95em] shrink-0" :style="color ? { color } : undefined" />{{ name }}</a
  >
</template>
