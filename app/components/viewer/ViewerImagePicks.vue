<script setup lang="ts">
// The images a comment box will send, as small previews, each with a button to take it out.
import type { ImagePick } from "~/composables/useImagePicks"

defineProps<{ picks: ImagePick[] }>()
const emit = defineEmits<{ remove: [pick: ImagePick] }>()
</script>

<template>
  <div v-if="picks.length" class="flex flex-wrap gap-1.5">
    <span
      v-for="pick in picks"
      :key="pick.url"
      class="relative size-12 overflow-hidden rounded-md border border-default bg-elevated"
    >
      <img :alt="pick.file.name" class="size-full object-cover" :src="pick.url" />
      <button
        :aria-label="`Remove ${pick.file.name || 'image'}`"
        class="absolute top-0.5 right-0.5 grid size-4 cursor-pointer place-items-center rounded-full bg-black/60 text-white before:absolute before:-inset-2"
        type="button"
        @click="emit('remove', pick)"
      >
        <UIcon class="size-2.5" name="i-mingcute-close-line" />
      </button>
    </span>
  </div>
</template>
