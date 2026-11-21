<script setup lang="ts">
const props = defineProps<{ name: string; kind?: string }>()
const logo = computed(() => agentLogo(props.name))
const fallback = computed(
  () =>
    ({ agent: "i-mingcute-sparkles-line", browser: "i-mingcute-user-3-line" })[props.kind ?? "browser"] ??
    "i-mingcute-user-3-line",
)
</script>

<template>
  <UIcon v-if="logo?.icon" :name="logo.icon" class="shrink-0" :style="logo.color ? { color: logo.color } : undefined" />
  <img v-else-if="logo" alt="" class="inline-block shrink-0 rounded-full" :src="logo.logo" />
  <UIcon v-else :name="fallback" class="shrink-0 text-muted" />
</template>
