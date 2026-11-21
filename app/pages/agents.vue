<script setup lang="ts">
import { RelativeTime } from "vite-hub/ui"
import type { TabsItem } from "@nuxt/ui"
import { PLAN_TEMPLATE } from "#shared/plan-template"
import type { SendEndpoint, SendTestResult } from "~/utils/comment-send"

definePageMeta({ middleware: () => void useAgentList() })

useSeoMeta({ title: "Agents" })

const origin = useRequestURL().origin
const server = `${origin}/mcp`
const MCP_SNIPPETS = mcpSnippets(server)
const clients: TabsItem[] = MCP_CLIENT_IDS.map((value) => ({ label: MCP_CLIENTS[value], value }))

const tabsUi = {
  list: "w-auto",
  indicator: "bg-default shadow-xs ring ring-default",
  trigger: "text-sm data-[state=active]:text-highlighted",
  leadingIcon: "hidden size-3.5 sm:inline-flex",
}

const client = ref<McpClient>("claude")
const { agents, status, disconnect } = useAgents()

const endpoint = ref<SendEndpoint | null>(null)
const tested = ref<SendTestResult | null>(null)
const testing = ref(false)
const loadEndpoint = async () => {
  endpoint.value = await dropSend.endpoint()
}
const pairable = ["T3 Code", "Claude Code", "Codex"]
async function sendTest() {
  testing.value = true
  try {
    tested.value = await dropSend.test()
  } finally {
    testing.value = false
  }
}
async function removeEndpoint() {
  await dropSend.remove()
  tested.value = null
}
let unwatchEndpoint: (() => void) | undefined
onMounted(() => {
  void loadEndpoint()
  unwatchEndpoint = dropSend.onChange(() => void loadEndpoint())
})
onBeforeUnmount(() => unwatchEndpoint?.())
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
          <DropCopyButton aria-label="Copy server URL" size="xs" :value="server" />
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
          >{{ MCP_HINTS[client] }} The
          <NuxtLink to="/skills" class="underline underline-offset-4">skills</NuxtLink> come with the server.</span
        >
        <UTooltip text="A starter HTML plan your agent can fill in and drop">
          <DropCopyButton label="Copy plan template" size="sm" :value="PLAN_TEMPLATE" />
        </UTooltip>
      </div>
      <p class="mt-3 border-t border-default pt-3 text-sm text-muted">
        Once it's connected, ask it for something to review, like “Write a one-page plan for what we're building next
        and drop it for review.” It answers with the link.
      </p>
    </UCard>

    <UCard class="mt-4" :ui="{ body: 'p-5 sm:p-5' }">
      <h2 class="font-medium text-highlighted">Send comments to</h2>
      <div
        v-if="!endpoint"
        class="mt-4 flex items-center gap-3 rounded-lg border border-dashed border-default px-4 py-3"
      >
        <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated ring-1 ring-default ring-inset">
          <UIcon name="i-mingcute-send-plane-line" class="size-4 text-muted" />
        </span>
        <div class="min-w-0">
          <p class="text-sm font-medium text-highlighted">Connect from any Send button.</p>
          <p class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span v-for="name in pairable" :key="name" class="inline-flex items-center gap-1">
              <AgentIcon :name="name" kind="agent" class="size-3.5" />{{ name }}
            </span>
          </p>
        </div>
      </div>
      <div v-else class="mt-4 flex items-center gap-3 rounded-lg border border-default px-4 py-3">
        <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated ring-1 ring-default ring-inset">
          <AgentIcon :name="endpoint.agent.name" kind="agent" class="size-5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-highlighted">{{ endpoint.agent.name }} · Default</p>
          <p v-if="tested?.status === 'delivered'" class="flex items-center gap-1 truncate text-xs text-success">
            <UIcon name="i-mingcute-check-circle-line" class="size-3.5 shrink-0" />{{
              tested.code === null ? "In the inbox" : `Delivered · ${tested.code} in ${tested.ms} ms`
            }}
          </p>
          <p v-else-if="tested" class="flex items-center gap-1 truncate text-xs text-error">
            <UIcon name="i-mingcute-alert-octagon-line" class="size-3.5 shrink-0" />Not delivered · {{ tested.reason }}
          </p>
          <p v-else class="truncate text-xs text-muted">
            {{ endpoint.agent.host ?? "Inbox" }}
            <template v-if="endpoint.lastSentAt"> · last sent <RelativeTime :at="endpoint.lastSentAt" /> </template>
          </p>
        </div>
        <UButton
          color="neutral"
          icon="i-mingcute-send-plane-line"
          label="Test default"
          :loading="testing"
          size="sm"
          variant="ghost"
          @click="sendTest"
        />
        <UButton color="neutral" label="Disconnect all" size="sm" variant="ghost" @click="removeEndpoint" />
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
            <p v-if="agent.connectedAt" class="truncate text-xs text-muted">
              Connected <RelativeTime :at="agent.connectedAt" />
            </p>
          </div>
          <UButton color="neutral" label="Disconnect" size="sm" variant="ghost" @click="disconnect(agent)" />
        </li>
      </ul>
    </section>
  </PageShell>
</template>
