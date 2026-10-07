<script setup lang="ts">
import type { TabsItem } from "@nuxt/ui"
import { PLAN_TEMPLATE } from "#shared/plan-template"

definePageMeta({ layout: "dashboard", middleware: "auth" })
useSeoMeta({ title: "Agents" })

type McpClient = "claude" | "codex" | "cursor" | "vscode" | "any"

const origin = useRequestURL().origin
const server = `${origin}/mcp`

// No keys to paste: each client signs in through the browser the first time, and keeps the token itself.
const MCP_CLIENTS: Record<McpClient, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", vscode: "VS Code", any: "Any client" }
const MCP_SNIPPETS: Record<McpClient, string> = {
  claude: `claude mcp add --transport http --scope user drop ${server}`,
  codex: `codex mcp add drop --url ${server}\ncodex mcp login drop`,
  cursor: `// ~/.cursor/mcp.json\n{\n  "mcpServers": {\n    "drop": { "url": "${server}" }\n  }\n}`,
  vscode: `// .vscode/mcp.json\n{\n  "servers": {\n    "drop": { "type": "http", "url": "${server}" }\n  }\n}`,
  any: `npx add-mcp ${server}`,
}
const MCP_HINTS: Record<McpClient, string> = {
  claude: "Then run /mcp in Claude Code and pick drop to sign in.",
  codex: "The login opens Drop in your browser.",
  cursor: "Cursor shows “Needs login” next to drop. Click it to sign in.",
  vscode: "VS Code asks to sign in the first time it starts the server.",
  any: "Your client opens Drop in the browser the first time it connects.",
}
const clients: TabsItem[] = (Object.keys(MCP_CLIENTS) as McpClient[]).map(value => ({ label: MCP_CLIENTS[value], value }))

// Executor's segmented control: the active tab is a raised white chip, not a filled button.
const tabsUi = { list: "w-auto", indicator: "bg-default shadow-xs ring ring-default", trigger: "text-sm data-[state=active]:text-highlighted", leadingIcon: "hidden size-3.5 sm:inline-flex" }

const client = ref<McpClient>("claude")
const { agents, status, disconnect } = useAgents()
const { copy } = useCopy()
</script>

<template>
  <PageShell id="agents" title="Agents" description="Connect an agent over MCP. It signs in through your browser once, and everything it drops starts private.">
    <UCard :ui="{ body: 'p-5 sm:p-5' }">
      <h2 class="font-medium text-highlighted">Connect an agent</h2>
      <div class="mt-4 space-y-3">
        <div class="flex items-center gap-2 rounded-md border border-default bg-muted py-1 pr-1 pl-3">
          <span class="label-mono">Server</span>
          <span class="min-w-0 flex-1 truncate font-mono text-xs text-highlighted">{{ server }}</span>
          <UButton aria-label="Copy server URL" color="neutral" icon="i-lucide-copy" size="xs" variant="ghost" @click="copy(server, 'Server URL copied')" />
        </div>
        <div class="-mx-1 overflow-x-auto px-1">
          <UTabs v-model="client" :items="clients" :content="false" color="neutral" size="sm" :ui="{ ...tabsUi, root: 'w-max' }" />
        </div>
      </div>
      <AgentsCodeBlock class="mt-4" :code="MCP_SNIPPETS[client]" />

      <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>{{ MCP_HINTS[client] }} The Drop skill comes with the server.</span>
        <UButton color="neutral" icon="i-lucide-copy" label="Template" size="sm" variant="ghost" @click="copy(PLAN_TEMPLATE, 'Template copied')" />
      </div>
    </UCard>

    <section class="mt-8">
      <h2 class="label-mono mb-2">Connected</h2>
      <ul class="divide-y divide-default rounded-lg border border-default">
        <li v-if="status === 'pending' && !agents.length" class="p-4">
          <USkeleton class="h-9 w-full" />
        </li>
        <li v-else-if="!agents.length" class="px-4 py-8 text-center text-sm text-muted">
          No agents yet. Add Drop's server to one above; it shows up here once you allow it.
        </li>
        <li v-for="agent in agents" :key="agent.id" class="flex items-center gap-3 px-4 py-3">
          <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated ring-1 ring-default ring-inset">
            <AgentIcon :name="agent.name" kind="agent" class="size-4" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-highlighted">{{ agent.name }}</p>
            <p v-if="agent.connectedAt" class="truncate text-xs text-muted">Connected <TimeAgo :at="agent.connectedAt" /></p>
          </div>
          <UButton color="neutral" label="Disconnect" size="sm" variant="ghost" @click="disconnect(agent)" />
        </li>
      </ul>
    </section>
  </PageShell>
</template>
