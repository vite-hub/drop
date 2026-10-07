<script setup lang="ts">
// What someone with the link sees: the drop, full screen, no sidebar. Private drops 404.
const route = useRoute("d-id")
const { drop, comments } = provideDrop(() => String(route.params.id))
await Promise.all([drop, comments])
useSeoMeta({ title: () => drop.data.value?.title ?? "Drop", robots: "noindex" })
</script>

<template>
  <UDashboardGroup v-if="drop.data.value" unit="rem" storage="cookie" storage-key="drop-public">
    <DropViewer :key="drop.data.value.id" public-view />
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
