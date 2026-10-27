<script setup lang="ts">
import { dropPath } from "#shared/links"
import type { DropComment, SiteReviewItem } from "#shared/types"

const props = defineProps<{ comment: DropComment; screenshot: NonNullable<SiteReviewItem["screenshot"]> }>()
const state = injectDrop()
const pageLink = computed(() => {
  const page = props.comment.page
  if (page?.startsWith("https://") || page?.startsWith("http://")) return page
  const site = state?.drop.data.value?.siteUrl
  return page?.startsWith("/") && !page.startsWith("//") && site && !site.includes("*")
    ? new URL(page, site).href
    : undefined
})
</script>

<template>
  <NuxtLink
    :to="`${dropPath(screenshot)}?comment=${comment.n}`"
    :aria-label="`Open screenshot for comment ${comment.n}`"
    class="flex items-center justify-center rounded-md bg-muted p-2"
  >
    <span class="relative block">
      <img
        :src="screenshot.url"
        :alt="`Screenshot of ${comment.page || 'the reviewed page'}`"
        class="block max-h-40 max-w-full rounded-sm object-contain outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
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
  </NuxtLink>
  <ULink v-if="pageLink" :href="pageLink" external target="_blank" class="text-xs text-muted hover:text-highlighted"
    >Open reviewed page</ULink
  >
</template>
