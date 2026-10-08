<script setup lang="ts">
import type { NuxtError } from "#app"
defineProps<{ error: NuxtError }>()
const route = useRoute()
const target = computed(() => route.path.startsWith("/f/") || route.path.startsWith("/d/") ? route.path : "")
</script>
<template>
  <NuxtLayout><div class="grid min-h-dvh place-items-center px-6 text-center"><div class="space-y-4">
    <h1 class="text-xl font-semibold">{{ error.statusCode === 404 ? "This content is unavailable." : "Could not open this page." }}</h1>
    <div class="flex justify-center gap-3"><UButton to="/" label="Home" color="neutral" variant="outline" /><UButton v-if="target" :to="{ path: '/report', query: { target } }" label="Report" color="neutral" variant="ghost" /></div>
  </div></div></NuxtLayout>
</template>
