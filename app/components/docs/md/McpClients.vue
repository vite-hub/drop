<script setup lang="ts">
import type { McpClient } from "~/utils/mcp-clients"

// `::mcp-clients`: this Drop's MCP address, then a heading, snippet, and sign-in hint for each client, from the same snippets the app shows.
const server = `${useRequestURL().origin}/mcp`
const snippets = mcpSnippets(server)
const clients = Object.keys(MCP_CLIENTS) as McpClient[]
</script>

<template>
  <p>Drop's MCP server is at <code>{{ server }}</code>. Add it to your client:</p>
  <template v-for="client in clients" :key="client">
    <h3>{{ MCP_CLIENTS[client] }}</h3>
    <AgentsCodeBlock :code="snippets[client]" />
    <p>{{ MCP_HINTS[client] }}</p>
  </template>
</template>
