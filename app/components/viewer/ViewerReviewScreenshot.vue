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
    <ViewerScreenshotImage class="max-h-40" :comment="comment" :url="screenshot.url" />
  </NuxtLink>
  <ULink v-if="pageLink" :href="pageLink" external target="_blank" class="text-xs text-muted hover:text-highlighted"
    >Open reviewed page</ULink
  >
</template>
