<script setup lang="ts">
import type { DropComment } from "#shared/types"

defineProps<{ comment: DropComment; url: string }>()
</script>

<template>
  <span class="relative block">
    <img
      :src="url"
      :alt="`Screenshot of ${comment.page || 'the reviewed page'}`"
      class="block max-h-[inherit] max-w-full rounded-sm object-contain outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
      loading="lazy"
    />
    <span
      aria-hidden="true"
      class="pointer-events-none absolute rounded-sm border-2 border-inverted"
      :style="{
        left: `${comment.ox / 10}%`,
        top: `${comment.oy / 10}%`,
        width: `${comment.ow / 10}%`,
        height: `${comment.oh / 10}%`,
      }"
    />
  </span>
</template>
