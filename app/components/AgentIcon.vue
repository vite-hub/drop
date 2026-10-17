<script setup lang="ts">
// Official mark for known agents (Claude Code, Codex, Cursor…), otherwise a neutral icon by how it connected.
const props = defineProps<{ name: string; kind?: string }>()
const logo = computed(() => agentLogo(props.name))
const fallback = computed(() => ({ agent: "i-ph-sparkle", browser: "i-ph-user" })[props.kind ?? "browser"] ?? "i-ph-user")
</script>

<template>
  <UIcon v-if="logo" :name="logo.icon" class="shrink-0" :style="logo.color ? { color: logo.color } : undefined" />
  <UIcon v-else :name="fallback" class="shrink-0 text-muted" />
</template>
