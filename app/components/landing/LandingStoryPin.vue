<script setup lang="ts">
// A numbered comment pin on a stage's page, popping in after `delay` ms.
defineProps<{ n: number; delay?: number }>()
</script>

<template>
  <span
    class="absolute -top-3 -right-4 grid size-5 place-items-center rounded-full bg-inverted text-[10px] font-semibold text-inverted ring-2 ring-(--ui-bg) [animation:pop-in_300ms_var(--ease-out)_both]"
    :style="{ animationDelay: `${delay ?? 0}ms` }"
    >{{ n }}</span
  >
</template>
