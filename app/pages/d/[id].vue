<script setup lang="ts">
// What someone with the link sees: the drop, full screen, no sidebar. Private drops 404.
import type { DropComment, DropDetail } from "#shared/types"

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data: drop, refresh } = await useApi<DropDetail>(() => `/api/drops/${id.value}`, { key: `drop:${id.value}` })
const { data: comments, refresh: refreshComments } = await useApi<DropComment[]>(() => `/api/drops/${id.value}/comments`, { key: `comments:${id.value}`, default: () => [] })
useSeoMeta({ title: () => drop.value?.title ?? "Drop", robots: "noindex" })
</script>

<template>
  <UDashboardGroup v-if="drop" unit="rem" storage="cookie" storage-key="drop-public">
    <DropViewer :key="drop.id" :comments="comments" :drop="drop" public-view @refresh="refresh" @refresh-comments="refreshComments" />
  </UDashboardGroup>
  <div v-else class="grid min-h-dvh place-items-center px-6 text-center">
    <div>
      <span class="mx-auto grid size-12 place-items-center rounded-full bg-elevated text-muted"><UIcon name="i-lucide-lock" class="size-5" /></span>
      <h1 class="mt-5 text-xl font-semibold text-highlighted">This drop is private, or it was deleted.</h1>
      <p class="mt-2 text-sm text-muted">Ask whoever sent the link to share it.</p>
      <UButton class="mt-6" color="neutral" label="What's Drop?" to="/" variant="outline" />
    </div>
  </div>
</template>
