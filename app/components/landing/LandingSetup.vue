<script setup lang="ts">
// Try it now: the agents are the picker. The selected one grows its name and takes its color, the others name
// themselves on hover. The card eases to each snippet's height inside a box sized for the tallest, so nothing under
// it moves when you switch.
const SNIPPETS = mcpSnippets(`${useRequestURL().origin}/mcp`)
const TRY = [
  { value: "claude", icon: "i-simple-icons-claude", color: "#D97757" },
  { value: "codex", icon: "i-simple-icons-openai" },
  { value: "cursor", icon: "i-simple-icons-cursor" },
  { value: "vscode", icon: "i-simple-icons-visualstudiocode", color: "#0098FF" },
  { value: "claudeai", icon: "i-simple-icons-anthropic" },
  { value: "chatgpt", icon: "i-mingcute-openai-line" },
  {
    value: "any",
    icon: "i-simple-icons-modelcontextprotocol",
    tip: "Any MCP client: Copilot, Gemini CLI, Zed, opencode…",
  },
] as const satisfies readonly { value: McpClient; icon: string; color?: string; tip?: string }[]
const client = ref<McpClient>("claude")

const content = useTemplateRef<HTMLElement>("content")
const { height } = useElementSize(content, undefined, { box: "border-box" })
</script>

<template>
  <!-- Tall enough for the six-line snippets (Cursor, VS Code). -->
  <div class="min-h-[14.5rem] sm:min-h-[13.5rem]">
    <div
      class="overflow-hidden rounded-xl border border-default bg-default shadow-xs transition-[height] duration-300 ease-(--ease-out) motion-reduce:transition-none"
      :style="height ? { height: `${height + 2}px` } : undefined"
    >
      <div ref="content" class="p-1.5">
        <div class="flex items-center justify-between gap-3 p-1">
          <h2 class="sr-only">Try it now</h2>
          <div role="group" aria-label="Your agent" class="flex flex-wrap items-center gap-0.5">
            <UTooltip
              v-for="item in TRY"
              :key="item.value"
              :text="'tip' in item ? item.tip : MCP_CLIENTS[item.value]"
              :disabled="client === item.value && !('tip' in item)"
            >
              <button
                type="button"
                :aria-pressed="client === item.value"
                :aria-label="MCP_CLIENTS[item.value]"
                class="flex h-7 items-center rounded-md px-2 text-xs outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted)"
                :class="
                  client === item.value
                    ? 'bg-elevated font-medium text-highlighted'
                    : 'text-dimmed hover:bg-muted hover:text-highlighted'
                "
                @click="client = item.value"
              >
                <UIcon
                  :name="item.icon"
                  class="size-4 shrink-0 transition-colors duration-200"
                  :style="client === item.value && 'color' in item ? { color: item.color } : undefined"
                />
                <!-- The name opens from zero width: a grid track that eases from 0fr to 1fr. -->
                <span
                  class="grid transition-[grid-template-columns,opacity] duration-300 ease-(--ease-out) motion-reduce:transition-none"
                  :class="client === item.value ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0'"
                  aria-hidden="true"
                  ><span class="overflow-hidden pl-1.5 whitespace-nowrap">{{ MCP_CLIENTS[item.value] }}</span></span
                >
              </button>
            </UTooltip>
          </div>
          <NuxtLink
            :to="`/docs/agents#${client}`"
            class="flex shrink-0 items-center gap-0.5 text-xs text-muted hover:text-highlighted"
            >Setup guide<UIcon name="i-mingcute-arrow-right-up-line" class="size-3.5"
          /></NuxtLink>
        </div>
        <AgentsCodeBlock class="mt-1" :code="SNIPPETS[client]" />
      </div>
    </div>
  </div>
</template>
