<script setup lang="ts">
import { contentUnavailable } from "#shared/content-unavailable"

const props = defineProps<{ status: number; path: string; waitingForReview?: boolean }>()
// Only failed views need the account lookup; successful shared views stay on their existing request path.
const { data: me } = await useMe()
// Behind an auth proxy (read at runtime, as on /signin) signing in again only returns the same account.
const { data: method } = await useApi("/api/sign-in", { key: "sign-in" })
const message = computed(() => contentUnavailable(props.status, props.path, me.value?.email, props.waitingForReview, Boolean(method.value?.proxy)))
const reportTarget = computed(() => props.path.split("?")[0]!.replace(/^\/drops\/([^/]+)\/?$/, "/d/$1"))
</script>

<template>
  <div class="grid min-h-full flex-1 place-items-center px-6 py-12 text-center">
    <div class="max-w-md">
      <span class="mx-auto grid size-12 place-items-center rounded-full bg-elevated text-muted"><UIcon :name="status >= 500 || status === 429 ? 'i-lucide-circle-alert' : status === 410 ? 'i-lucide-clock' : 'i-lucide-lock'" class="size-5" /></span>
      <h1 class="mt-5 text-xl font-semibold text-highlighted">{{ message.title }}</h1>
      <p v-if="message.email" class="mt-2 text-sm text-muted">Signed in as <span class="font-medium text-highlighted">{{ message.email }}</span>.</p>
      <p class="mt-2 text-sm leading-relaxed text-muted">{{ message.description }}</p>
      <div class="mt-6 flex flex-wrap justify-center gap-2">
        <UButton color="neutral" :label="message.action.label" :to="message.action.to" :external="message.action.to === path" />
        <UButton v-if="message.email && message.action.to !== '/drops'" color="neutral" label="My drops" to="/drops" variant="outline" />
        <UButton :to="{ path: '/report', query: { target: reportTarget } }" label="Report" color="neutral" variant="ghost" />
      </div>
    </div>
  </div>
</template>
