<script setup lang="ts">
// What someone with the link sees: the drop, full screen, no sidebar. Private drops 404.
const route = useRoute("d-id")
const { drop, comments } = provideDrop(() => String(route.params.id))
await Promise.all([drop, comments])
useSeoMeta({ title: () => drop.data.value?.title ?? "Drop", robots: "noindex, nofollow" })
// A visit beacon: unfurlers and crawlers never run this, so only people reading the link keep the drop alive.
onMounted(() => drop.data.value && $fetch(`/api/drops/${drop.data.value.id}/visit`, { method: "POST" }).catch(() => {}))
const waiting = computed(() => (drop.error.value?.data as { data?: { shareReview?: string } } | undefined)?.data?.shareReview === "pending")
</script>

<template>
  <UDashboardGroup v-if="drop.data.value" unit="rem" storage="cookie" storage-key="drop-public">
    <DropViewer :key="drop.data.value.id" public-view />
  </UDashboardGroup>
  <ContentUnavailable v-else class="min-h-dvh" :status="drop.error.value?.statusCode ?? 500" :path="route.fullPath" :waiting-for-review="waiting" />
</template>
