<script setup lang="ts">
import DropMark from "../../../app/components/DropMark.vue"
</script>

<template>
  <div class="relative h-40 overflow-hidden rounded-lg border border-default bg-muted" aria-hidden="true">
    <span class="absolute top-4 left-4 h-2.5 w-24 rounded-full bg-accented" />
    <span class="absolute top-4 right-4 h-2.5 w-28 rounded-full bg-accented" />
    <span class="absolute top-11 left-4 h-4 w-56 rounded bg-accented" />
    <span class="absolute top-18 left-4 h-2 w-72 rounded-full bg-accented/70" />
    <span class="absolute top-22 left-4 h-2 w-64 rounded-full bg-accented/70" />
    <span class="absolute top-28 left-4 h-7 w-20 rounded-md bg-accented" />
    <span class="absolute top-27 left-3 h-9 w-22 rounded-md border-2 border-dashed border-info" />
    <span
      class="absolute top-23 left-24 grid size-6 place-items-center rounded-full rounded-bl-none bg-inverted text-xs font-medium text-inverted"
      >A</span
    >
    <div
      class="absolute right-4 bottom-4 flex items-center gap-3 rounded-full bg-neutral-900 py-1.5 ps-3 pe-1.5 text-xs text-white"
    >
      <span class="flex items-center gap-1"><UIcon name="i-mingcute-chat-1-line" class="size-3.5" />Comment</span>
      <span class="flex items-center gap-1"><UIcon name="i-mingcute-pen-line" class="size-3.5" />Marker</span>
      <span class="flex items-center gap-1"><UIcon name="i-mingcute-ruler-line" class="size-3.5" />Measure</span>
      <span class="grid size-6 place-items-center rounded-full bg-white/10"><DropMark class="h-3.5 w-5" /></span>
    </div>
  </div>
</template>
