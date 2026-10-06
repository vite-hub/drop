<script setup lang="ts">
import type { TabsItem } from "@nuxt/ui"
import type { ApiKeyRow } from "#shared/types"
import { PLAN_TEMPLATE } from "#shared/plan-template"

definePageMeta({ layout: "dashboard", middleware: "auth" })
useSeoMeta({ title: "Agents" })

type Method = "mcp" | "api-key" | "agent-auth"
type McpClient = "claude" | "codex" | "cursor" | "vscode" | "any"

const origin = useRequestURL().origin
const server = `${origin}/mcp`
const route = useRoute()
const router = useRouter()
const toast = useToast()

const MCP_CLIENTS: Record<McpClient, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", vscode: "VS Code", any: "Any client" }
const MCP_SNIPPETS: Record<McpClient, string> = {
  claude: `claude mcp add --transport http --scope user drop ${server} \\\n  --header "Authorization: Bearer $DROP_API_KEY"`,
  codex: `codex mcp add drop --url ${server} --bearer-token-env-var DROP_API_KEY`,
  cursor: `// ~/.cursor/mcp.json\n{\n  "mcpServers": {\n    "drop": {\n      "url": "${server}",\n      "headers": { "Authorization": "Bearer \${env:DROP_API_KEY}" }\n    }\n  }\n}`,
  vscode: `// .vscode/mcp.json\n{\n  "inputs": [{ "type": "promptString", "id": "drop-key", "description": "Drop API key", "password": true }],\n  "servers": {\n    "drop": { "type": "http", "url": "${server}", "headers": { "Authorization": "Bearer \${input:drop-key}" } }\n  }\n}`,
  any: `npx add-mcp ${server} --header "Authorization: Bearer $DROP_API_KEY"`,
}

const methods: TabsItem[] = [
  { label: "MCP", value: "mcp", icon: "i-lucide-plug" },
  { label: "API key", value: "api-key", icon: "i-lucide-key-round" },
  { label: "Agent Auth", value: "agent-auth", icon: "i-lucide-shield-check", badge: { label: "Soon", color: "neutral", variant: "outline", size: "sm" } },
]
const clients: TabsItem[] = (Object.keys(MCP_CLIENTS) as McpClient[]).map(value => ({ label: MCP_CLIENTS[value], value }))

// Executor's segmented control: the active tab is a raised white chip, not a filled button.
const tabsUi = { list: "w-auto", indicator: "bg-default shadow-xs ring ring-default", trigger: "text-sm data-[state=active]:text-highlighted", leadingIcon: "hidden size-3.5 sm:inline-flex" }

const isMethod = (value: unknown): value is Method => value === "mcp" || value === "api-key" || value === "agent-auth"
const method = computed<Method>({
  get: () => (isMethod(route.query.tab) ? route.query.tab : "mcp"),
  set: tab => void router.replace({ query: { ...route.query, tab: tab === "mcp" ? undefined : tab } }),
})
const client = ref<McpClient>("claude")
const command = computed(() => (method.value === "mcp" ? MCP_SNIPPETS[client.value] : `npx skills add ${origin}\nexport DROP_API_KEY=drop_…`))

const { data: keys, status, refresh } = useFetch<ApiKeyRow[]>("/api/keys", { key: "keys", default: () => [], headers: sessionHeaders() })
// Taken once on the server and reused on hydration, so relative times match.
const now = useState("now", () => Date.now())
onMounted(() => (now.value = Date.now()))
const keyDialog = ref(false)
const revoking = ref<ApiKeyRow | null>(null)
const revokeBusy = ref(false)

async function copy(text: string, message: string) {
  await navigator.clipboard.writeText(text)
  toast.add({ title: message, icon: "i-lucide-check" })
}

async function revoke() {
  const key = revoking.value
  if (!key) return
  revokeBusy.value = true
  try {
    await $fetch(`/api/keys/${key.id}`, { method: "DELETE" })
    toast.add({ title: `Revoked “${key.name}”`, description: "Anything using it gets a 401 on its next request." })
    revoking.value = null
    await refresh()
  }
  catch (error) {
    toast.add({ title: "Couldn't revoke the key", description: errorText(error), color: "error" })
  }
  finally {
    revokeBusy.value = false
  }
}
</script>

<template>
  <PageShell id="agents" title="Agents" description="Let agents drop for you over MCP or with an API key. Everything they drop starts private.">
    <UCard :ui="{ body: 'p-5 sm:p-5' }">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="font-medium text-highlighted">Connect an agent</h2>
        <UTabs v-model="method" :items="methods" :content="false" color="neutral" size="sm" :ui="tabsUi" />
      </div>

      <div v-if="method === 'agent-auth'" class="mt-4 rounded-md border border-dashed border-default px-4 py-5">
        <p class="text-sm font-medium text-highlighted">Agent Auth is coming</p>
        <p class="mt-1 max-w-xl text-sm text-muted">
          Each agent gets its own identity and asks for exactly what it needs; you approve it here with a short code. This server doesn't support it yet. Use MCP or an API key for now.
        </p>
        <UButton class="mt-3" color="neutral" variant="outline" size="sm" label="Use MCP" icon="i-lucide-plug" @click="method = 'mcp'" />
      </div>

      <template v-else>
        <div v-if="method === 'mcp'" class="mt-4 space-y-3">
          <div class="flex items-center gap-2 rounded-md border border-default bg-muted py-1 pr-1 pl-3">
            <span class="label-mono">Server</span>
            <span class="min-w-0 flex-1 truncate font-mono text-xs text-highlighted">{{ server }}</span>
            <UButton aria-label="Copy server URL" color="neutral" icon="i-lucide-copy" size="xs" variant="ghost" @click="copy(server, 'Server URL copied')" />
          </div>
          <div class="-mx-1 overflow-x-auto px-1">
            <UTabs v-model="client" :items="clients" :content="false" color="neutral" size="sm" :ui="{ ...tabsUi, root: 'w-max' }" />
          </div>
        </div>
        <AgentsCodeBlock class="mt-4" :code="command" />
      </template>

      <div class="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span v-if="method === 'mcp'">Uses a Drop API key as the bearer token. Tools: list, read, comments, create, publish.</span>
        <span v-else-if="method === 'api-key'">Installs the Drop skill. Then give your agent a key from below.</span>
        <span v-else />
        <span class="flex gap-1">
          <UButton color="neutral" icon="i-lucide-copy" label="Template" size="sm" variant="ghost" @click="copy(PLAN_TEMPLATE, 'Template copied')" />
          <UButton v-if="method !== 'agent-auth'" color="neutral" icon="i-lucide-plus" label="New key" size="sm" variant="ghost" @click="keyDialog = true" />
        </span>
      </div>
    </UCard>

    <section class="mt-8">
      <h2 class="label-mono mb-2">Connected</h2>
      <div class="rounded-lg border border-default px-4 py-6 text-center text-sm text-muted">
        Agents connected with Agent Auth will show here. Until then, each agent uses its own API key.
      </div>
    </section>

    <section class="mt-8">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="label-mono">API keys</h2>
        <UButton color="neutral" icon="i-lucide-plus" label="New" size="sm" variant="ghost" @click="keyDialog = true" />
      </div>
      <ul class="divide-y divide-default rounded-lg border border-default">
        <li v-if="status === 'pending' && !keys.length" class="p-4">
          <USkeleton class="h-9 w-full" />
        </li>
        <li v-else-if="!keys.length" class="px-4 py-8 text-center text-sm text-muted">
          No keys yet. Name one after the agent that will use it, like “Claude Code”.
        </li>
        <li v-for="key in keys" :key="key.id" class="flex items-center gap-3 px-4 py-3">
          <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-elevated ring-1 ring-default ring-inset">
            <AgentIcon :name="key.name" kind="key" class="size-4" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-highlighted">{{ key.name }}</p>
            <p class="truncate font-mono text-xs text-muted">
              {{ key.start ? `${key.start}…` : "drop_…" }} · {{ key.lastRequest ? `used ${timeAgo(key.lastRequest, now)}` : "never used" }}
            </p>
          </div>
          <UButton color="neutral" label="Revoke" size="sm" variant="ghost" @click="revoking = key" />
        </li>
      </ul>
    </section>

    <AgentsCreateKeyDialog v-model:open="keyDialog" @created="refresh()" />

    <UModal
      :open="revoking !== null"
      :title="`Revoke “${revoking?.name ?? ''}”?`"
      description="Anything using it gets a 401 on its next request. Drops it made stay."
      @update:open="value => { if (!value) revoking = null }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" label="Cancel" variant="ghost" @click="revoking = null" />
          <UButton color="error" label="Revoke" :loading="revokeBusy" @click="revoke" />
        </div>
      </template>
    </UModal>
  </PageShell>
</template>
