<script setup lang="ts">
import { MCP_LATEST, MCP_LEGACY } from "#shared/mcp"

defineProps<{ latest?: boolean }>()
</script>

<template>
  <code v-if="latest">{{ MCP_LATEST }}</code>
  <span v-else>{{ MCP_LEGACY.join(", ") }}</span>
</template>
