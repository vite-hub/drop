<script setup lang="ts">
// `::mcp-tools`: a table of the MCP server's own catalog (tools, prompts, skill resources), so the docs never drift from it.
const { data: catalog } = await useApi("/api/mcp", { key: keys.mcpCatalog, default: () => [] })
const tools = computed(() =>
  catalog.value.map((item) => ({
    name: item.uri ?? item.name,
    description: item.description ?? item.title ?? "",
    kind: item.kind,
  })),
)
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-default">
    <table class="table-fixed">
      <thead>
        <tr>
          <th class="w-36 sm:w-44">Name</th>
          <th>What it does</th>
          <th class="hidden w-24 sm:table-cell">Kind</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="tool in tools" :key="tool.name">
          <td class="font-mono text-xs break-words">{{ tool.name }}</td>
          <td>{{ tool.description }}</td>
          <td class="hidden font-mono text-xs sm:table-cell">{{ tool.kind }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
