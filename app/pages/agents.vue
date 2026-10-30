<script setup lang="ts">
import type { TabsItem } from "@nuxt/ui"
import { PLAN_TEMPLATE } from "#shared/plan-template"

// Started before the layout renders, which waits for your drops first, so the agents load alongside them.
definePageMeta({ middleware: () => void useAgentList() })

useSeoMeta({ title: "Agents" })

const origin = useRequestURL().origin
const server = `${origin}/mcp`
const MCP_SNIPPETS = mcpSnippets(server)
const clients: TabsItem[] = MCP_CLIENT_IDS.map((value) => ({ label: MCP_CLIENTS[value], value }))

// Executor's segmented control: the active tab is a raised white chip, not a filled button.
const tabsUi = {
  list: "w-auto",
  indicator: "bg-default shadow-xs ring ring-default",
  trigger: "text-sm data-[state=active]:text-highlighted",
  leadingIcon: "hidden size-3.5 sm:inline-flex",
}

const client = ref<McpClient>("claude")
const { agents, status, disconnect } = useAgents()
const { copy, copied } = useCopy()
</script>

<template>
  <PageShell
    id="agents"
    title="Agents"
    description="Connect an agent over MCP. It signs in through your browser once, and everything it drops starts private."
  >
    <UCard :ui="{ body: 'p-5 sm:p-5' }">
      <h2 class="font-medium text-highlighted">Connect an agent</h2>
      <div class="mt-4 space-y-3">
        <div class="flex items-center gap-2 rounded-md border border-default bg-muted py-1 pr-1 pl-3">
          <span class="label-mono">Server</span>
          <span class="min-w-0 flex-1 truncate font-mono text-xs text-highlighted">{{ server }}</span>
          <UButton
            aria-label="Copy server URL"
            color="neutral"
            :icon="copied('server') ? 'i-mingcute-check-line' : 'i-mingcute-copy-2-line'"
            size="xs"
            variant="ghost"
            @click="copy(server, { key: 'server' })"
          />
        </div>
        <div class="-mx-1 overflow-x-auto px-1">
          <UTabs
            v-model="client"
            :items="clients"
            :content="false"
            color="neutral"
            size="sm"
            :ui="{ ...tabsUi, root: 'w-max' }"
          />
        </div>
      </div>
      <AgentsCodeBlock class="mt-4" :code="MCP_SNIPPETS[client]" />

      <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span
          >{{ MCP_HINTS[client] }} The <NuxtLink to="/skills" class="underline">skills</NuxtLink> come with the
          server.</span
        >
        <!-- A bare "Template" said nothing about what it copies. -->
        <UTooltip text="A starter HTML plan your agent can fill in and drop">
          <UButton
            color="neutral"
            :icon="copied('template') ? 'i-mingcute-check-line' : 'i-mingcute-copy-2-line'"
            :label="copied('template') ? 'Copied' : 'Copy Plan Template'"
            size="sm"
            variant="ghost"
            @click="copy(PLAN_TEMPLATE, { key: 'template' })"
          />
        </UTooltip>
      </div>
      <p class="mt-3 border-t border-default pt-3 text-sm text-muted">
        Once it's connected, ask it for something to review, like “Write a one-page plan for what we're building next
        and drop it for review.” It answers with the link.
      </p>
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
            <p v-if="agent.connectedAt" class="truncate text-xs text-muted">
              Connected <TimeAgo :at="agent.connectedAt" />
            </p>
          </div>
          <UButton color="neutral" label="Disconnect" size="sm" variant="ghost" @click="disconnect(agent)" />
        </li>
      </ul>
    </section>
  </PageShell>
</template>
