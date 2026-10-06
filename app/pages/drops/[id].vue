<script setup lang="ts">
import type { DropComment, DropDetail } from "#shared/types"

definePageMeta({ layout: "dashboard", middleware: "auth" })

const route = useRoute()
const id = computed(() => String(route.params.id))
const { data: drop, error, refresh } = await useApi<DropDetail>(() => `/api/drops/${id.value}`, { key: `drop:${id.value}` })
const { data: comments, refresh: refreshComments } = await useApi<DropComment[]>(() => `/api/drops/${id.value}/comments`, { key: `comments:${id.value}`, default: () => [] })
useSeoMeta({ title: () => drop.value?.title ?? "Drop" })
</script>

<template>
  <DropViewer v-if="drop" :key="drop.id" :comments="comments" :drop="drop" @refresh="refresh" @refresh-comments="refreshComments" />
  <UDashboardPanel v-else id="drop-missing">
    <template #body>
      <div class="grid flex-1 place-items-center text-center">
        <div>
          <UIcon name="i-lucide-lock" class="size-6 text-dimmed" />
          <h1 class="mt-3 text-lg font-semibold">{{ error ? "This drop is private, or it was deleted." : "Loading…" }}</h1>
          <UButton class="mt-5" color="neutral" label="Back to Drops" to="/drops" variant="outline" />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
