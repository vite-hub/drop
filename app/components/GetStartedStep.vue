<script setup lang="ts">
// What one Get started step says and offers: under its title on the first run, in a popover once there are drops.
import type { DropSummary } from "#shared/types"

const { step, team, firstDoc } = defineProps<{ step: string; team: boolean; firstDoc?: DropSummary }>()
const emit = defineEmits<{ upload: []; site: [] }>()

const origin = useRequestURL().origin
const snippets = mcpSnippets(`${origin}/mcp`)
const clients = MCP_CLIENT_IDS.map((value) => ({ label: MCP_CLIENTS[value], value }))
const client = ref<McpClient>("claude")
const PROMPT = "Write a one-page plan for what we're building next and drop it for review."

const tabsUi = {
  list: "w-auto",
  indicator: "bg-default shadow-xs ring ring-default",
  trigger: "text-xs data-[state=active]:text-highlighted",
}
</script>

<template>
  <div class="space-y-3 text-sm text-pretty text-muted">
    <template v-if="step === 'agent'">
      <p>Add Drop's server to your agent. It signs in through your browser once; there are no keys to paste.</p>
      <div class="-mx-1 overflow-x-auto px-1">
        <UTabs
          v-model="client"
          :content="false"
          color="neutral"
          :items="clients"
          size="xs"
          :ui="{ ...tabsUi, root: 'w-max' }"
        />
      </div>
      <AgentsCodeBlock :code="snippets[client]" />
      <p>
        {{ MCP_HINTS[client] }} It shows up under
        <NuxtLink class="text-highlighted underline" to="/agents">Agents</NuxtLink> once you allow it.
      </p>
    </template>

    <template v-else-if="step === 'drop'">
      <p>Ask your agent for something to review. It answers with the link, and the drop lands here, private to you.</p>
      <AgentsCodeBlock :code="PROMPT" />
      <p class="flex flex-wrap items-center gap-x-2 gap-y-1">
        Or drop a Markdown, HTML, or image file yourself.
        <UButton
          color="neutral"
          icon="i-mingcute-upload-2-line"
          label="Upload a file"
          size="xs"
          variant="outline"
          @click="emit('upload')"
        />
      </p>
    </template>

    <template v-else-if="step === 'share'">
      <p v-if="team">
        Your team sees what you drop, and comments on it. Press Share to keep one to yourself, let the team edit it, or
        open a public link for people outside.
      </p>
      <p v-else>
        Everything starts private. Open a drop and press Share to turn on a public link, and choose whether people with
        it can comment.
      </p>
      <UButton
        v-if="firstDoc"
        color="neutral"
        :label="`Open ${firstDoc.title}`"
        size="xs"
        :to="`/drops/${firstDoc.id}`"
        trailing-icon="i-mingcute-arrow-right-line"
        variant="outline"
      />
      <p v-else>Drop something first.</p>
    </template>

    <template v-else>
      <p>
        Comment on any live website, such as a preview build, with a bookmarklet. Each note arrives with a screenshot
        your agent can read.
      </p>
      <UButton
        color="neutral"
        icon="i-mingcute-globe-line"
        label="New site review"
        size="xs"
        variant="outline"
        @click="emit('site')"
      />
    </template>
  </div>
</template>
