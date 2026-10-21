<script setup lang="ts">
import type { McpClient } from "~/utils/mcp-clients"

// `::mcp-snippet{client="claude"}`: how one MCP client connects to this Drop, from the same snippets the app shows.
const props = defineProps<{ client: McpClient }>()
const origin = useRequestURL().origin
const code = computed(() => mcpSnippets(`${origin}/mcp`)[props.client])
</script>

<template>
  <AgentsCodeBlock :code="code" />
</template>
