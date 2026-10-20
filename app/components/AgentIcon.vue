<script setup lang="ts">
// Official mark for known agents (Claude Code, Codex, Cursor…), otherwise a neutral icon by how it connected.
const props = defineProps<{ name: string; kind?: string }>()
const logo = computed(() => agentLogo(props.name))
const fallback = computed(
  () =>
    ({ agent: "i-mingcute-sparkles-line", browser: "i-mingcute-user-3-line" })[props.kind ?? "browser"] ??
    "i-mingcute-user-3-line",
)
</script>

<template>
  <UIcon v-if="logo" :name="logo.icon" class="shrink-0" :style="logo.color ? { color: logo.color } : undefined" />
  <UIcon v-else :name="fallback" class="shrink-0 text-muted" />
</template>
