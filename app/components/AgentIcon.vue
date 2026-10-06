<script setup lang="ts">
// Official mark for known agents (Claude Code, Codex, Cursor…), otherwise a neutral icon by how it connected.
const props = defineProps<{ name: string; kind?: string }>()
const logo = computed(() => agentLogo(props.name))
const fallback = computed(() => ({ agent: "i-lucide-bot", key: "i-lucide-key-round", browser: "i-lucide-user" })[props.kind ?? "browser"] ?? "i-lucide-user")
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <svg v-if="logo" aria-hidden="true" class="shrink-0" :fill="logo.color ?? 'currentColor'" :viewBox="logo.viewBox" v-html="logo.body" />
  <UIcon v-else :name="fallback" class="shrink-0 text-muted" />
</template>
