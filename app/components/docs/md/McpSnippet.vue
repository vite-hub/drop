<script setup lang="ts">
import type { McpClient } from "~/utils/mcp-clients"

const props = defineProps<{ client: McpClient }>()
const origin = useRequestURL().origin
const code = computed(() => mcpSnippets(`${origin}/mcp`)[props.client])
</script>

<template>
  <AgentsCodeBlock :code="code" />
</template>
