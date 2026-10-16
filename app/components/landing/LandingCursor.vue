<script setup lang="ts">
// Someone's pointer on a stage: glides to (x, y), with a name tag for everyone but you.
defineProps<{ x: number; y: number; shown: boolean; label?: string }>()
</script>

<template>
  <div
    class="pointer-events-none absolute top-0 left-0 z-40 flex items-start transition-[transform,opacity] duration-700 ease-(--ease-out)"
    :class="!shown && 'opacity-0'"
    :style="{ transform: `translate(${x}px, ${y}px)` }"
  >
    <svg viewBox="0 0 16 16" class="size-4 drop-shadow-sm" aria-hidden="true">
      <path d="M2 1.5 14 7l-5.2 1.6L6.6 14z" class="fill-(--ui-text-highlighted) stroke-(--ui-bg)" stroke-width="1.2" stroke-linejoin="round" />
    </svg>
    <span v-if="label" class="mt-3 -ml-1 rounded-full bg-inverted px-1.5 py-0.5 text-[10px] font-medium text-inverted">{{ label }}</span>
  </div>
</template>
