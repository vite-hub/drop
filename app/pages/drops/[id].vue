<script setup lang="ts">
const route = useRoute("drops-id")
const { drop, comments } = provideDrop(() => route.params.id)
await Promise.all([drop, comments])
useSeoMeta({ title: () => drop.data.value?.title ?? "Drop" })
const waiting = computed(() => waitingForReview(drop.error.value))
const here = useHerePath()
</script>

<template>
  <DropViewer v-if="drop.data.value" :key="drop.data.value.id" />
  <UDashboardPanel v-else id="drop-missing">
    <template #body>
      <ContentUnavailable v-if="drop.error.value" :status="drop.error.value.status" :path="here" :waiting-for-review="waiting" />
      <p v-else class="m-auto text-sm text-muted">Loading…</p>
    </template>
  </UDashboardPanel>
</template>
