<script setup lang="ts">
import { MCP_LATEST, MCP_LEGACY } from "#shared/mcp"

// `:mcp-versions{latest}`: the MCP version Drop speaks, as code. `:mcp-versions`: the older versions it still answers, comma-separated.
defineProps<{ latest?: boolean }>()
</script>

<template>
  <code v-if="latest">{{ MCP_LATEST }}</code>
  <span v-else>{{ MCP_LEGACY.join(", ") }}</span>
</template>
