<script setup lang="ts">
import type { NuxtError } from "#app"
const props = defineProps<{ error: NuxtError }>()
const path = useRequestURL().pathname
const target = path.startsWith("/f/") || path.startsWith("/d/") ? path : ""
const missing = computed(() => props.error.status === 404)
</script>
<template>
  <NuxtLayout
    ><div class="grid min-h-dvh place-items-center px-6 text-center">
      <div class="space-y-4">
        <h1 class="text-xl font-semibold">
          {{ missing ? "This content is unavailable." : "Could not open this page." }}
        </h1>
        <div class="flex justify-center gap-3">
          <UButton v-if="!missing" :to="path" external label="Try again" color="neutral" /><UButton
            to="/"
            label="Home"
            color="neutral"
            variant="outline"
          /><UButton
            v-if="target"
            :to="{ path: '/report', query: { target } }"
            label="Report"
            color="neutral"
            variant="ghost"
          />
        </div>
      </div></div
  ></NuxtLayout>
</template>
