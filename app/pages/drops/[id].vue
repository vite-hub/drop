<script setup lang="ts">
const route = useRoute("drops-id")
const { drop, comments } = provideDrop(() => route.params.id)
await Promise.all([drop, comments])
useSeoMeta({ title: () => drop.data.value?.title ?? "Drop" })
const waiting = computed(() => waitingForReview(drop.error.value))
const here = useHerePath()
</script>

<template>
  <DropViewer v-if="drop.data.value" :key="`${drop.data.value.id}@${drop.data.value.version}`" />
  <UDashboardPanel v-else id="drop-missing">
    <template #header>
      <!-- The viewer's bar while it loads or can't open, so the page keeps its line and doesn't jump. -->
      <UDashboardNavbar :ui="{ root: 'h-12 gap-2 px-2 sm:px-3' }">
        <template #left>
          <SidebarExpand />
          <UButton
            aria-label="Back to drops"
            color="neutral"
            icon="i-mingcute-arrow-left-line"
            size="sm"
            variant="ghost"
            to="/drops"
          />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <ContentUnavailable
        v-if="drop.error.value"
        :status="drop.error.value.status"
        :path="here"
        :waiting-for-review="waiting"
      />
      <p v-else class="m-auto text-sm text-muted">Loading…</p>
    </template>
  </UDashboardPanel>
</template>
