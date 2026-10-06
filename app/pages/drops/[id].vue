<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" })

const route = useRoute("drops-id")
const { drop, comments } = provideDrop(() => route.params.id)
await Promise.all([drop, comments])
useSeoMeta({ title: () => drop.data.value?.title ?? "Drop" })
</script>

<template>
  <DropViewer v-if="drop.data.value" :key="drop.data.value.id" />
  <UDashboardPanel v-else id="drop-missing">
    <template #body>
      <div class="grid flex-1 place-items-center text-center">
        <div>
          <UIcon name="i-lucide-lock" class="size-6 text-dimmed" />
          <h1 class="mt-3 text-lg font-semibold">{{ drop.error.value ? "This drop is private, or it was deleted." : "Loading…" }}</h1>
          <UButton class="mt-5" color="neutral" label="Back to Drops" to="/drops" variant="outline" />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
