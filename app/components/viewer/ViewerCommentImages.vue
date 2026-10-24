<script setup lang="ts">
// The images sent with a comment or a reply. Each opens full size in a new tab.
import type { CommentAttachment } from "#shared/types"

defineProps<{ attachments: CommentAttachment[] }>()
</script>

<template>
  <div v-if="attachments.length" class="flex flex-wrap gap-1.5">
    <a
      v-for="file in attachments"
      :key="file.id"
      class="block overflow-hidden rounded-md border border-default bg-elevated"
      :href="file.url"
      rel="noopener"
      target="_blank"
      :title="file.filename"
      @click.stop
    >
      <img :alt="file.filename" class="block max-h-28 max-w-40 object-contain" loading="lazy" :src="file.url" />
    </a>
  </div>
</template>
