<script setup lang="ts">
import DropMark from "../../../app/components/DropMark.vue"
</script>

<template>
  <div class="relative h-36" aria-hidden="true">
    <div class="flex items-center gap-2 rounded-lg border border-default bg-muted px-3 py-2">
      <UIcon name="i-mingcute-left-line" class="size-4 text-dimmed" />
      <UIcon name="i-mingcute-right-line" class="size-4 text-dimmed" />
      <div class="flex flex-1 items-center gap-2 rounded-full bg-default px-3 py-1 text-sm text-muted">
        <UIcon name="i-mingcute-world-2-line" class="size-3.5" />example.com
      </div>
      <span class="grid size-7 place-items-center rounded-full bg-accented">
        <UIcon name="i-mingcute-plugin-2-line" class="size-4" />
      </span>
    </div>
    <div
      class="absolute top-12 right-2 w-56 rounded-lg bg-default p-1.5 text-sm shadow-md ring ring-default dark:bg-elevated"
    >
      <p class="px-2 py-1 text-xs text-muted">Extensions</p>
      <div class="flex items-center gap-2 rounded-md bg-elevated px-2 py-1.5 dark:bg-accented">
        <DropMark class="h-3.5 w-5" /><span class="flex-1">Drop</span>
        <span class="grid size-6 place-items-center rounded-full ring-2 ring-info">
          <UIcon name="i-mingcute-pin-line" class="size-3.5" />
        </span>
      </div>
      <div class="flex items-center gap-2 px-2 py-1.5 text-dimmed">
        <UIcon name="i-mingcute-code-line" class="size-3.5 w-5" /><span class="flex-1">Another extension</span>
        <UIcon name="i-mingcute-pin-line" class="mx-1 size-3.5" />
      </div>
    </div>
  </div>
</template>
