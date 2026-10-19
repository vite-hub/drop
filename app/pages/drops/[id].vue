<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" })

const route = useRoute("drops-id")
const { drop, comments } = provideDrop(() => route.params.id)
await Promise.all([drop, comments])
useSeoMeta({ title: () => drop.data.value?.title ?? "Drop" })
const waiting = computed(() => (drop.error.value?.data as { data?: { shareReview?: string } } | undefined)?.data?.shareReview === "pending")
</script>

<template>
  <DropViewer v-if="drop.data.value" :key="drop.data.value.id" />
  <UDashboardPanel v-else id="drop-missing">
    <template #body>
      <ContentUnavailable v-if="drop.error.value" :status="drop.error.value.status" :path="route.fullPath" :waiting-for-review="waiting" />
      <p v-else class="m-auto text-sm text-muted">Loading…</p>
    </template>
  </UDashboardPanel>
</template>
