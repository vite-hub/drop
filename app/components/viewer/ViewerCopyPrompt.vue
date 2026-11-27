<script setup lang="ts">
import type { CopyValue } from "vite-hub/ui"
import type { ConnectedAgent } from "#shared/types"

const props = defineProps<{ value: CopyValue; count: number; errors?: number; signedIn: boolean }>()
const agents = ref<ConnectedAgent[] | null>(null)
async function load() {
  if (props.signedIn) agents.value = await $fetch<ConnectedAgent[]>("/api/agents").catch(() => agents.value)
}
onMounted(load)
useEventListener("focus", () => agents.value?.length === 0 && void load())
const noAgent = computed(() => agents.value?.length === 0)
const open = ref(false)
const tip = computed(() => {
  const comments = props.count
    ? `${props.count === 1 ? "the comment" : `the ${props.count} comments`} that wait for an answer`
    : ""
  const errors = props.errors ? (props.errors === 1 ? "the page error" : `the ${props.errors} page errors`) : ""
  return `Copy a prompt with ${[comments, errors].filter(Boolean).join(" and ")}, for your agent`
})
const button = {
  "aria-label": "Copy prompt for your agent",
  class: "[animation:pop-in_200ms_var(--ease-out)]",
  color: "neutral",
  "data-usage": "copy-prompt",
  icon: "i-mingcute-copy-2-line",
  size: "xs",
  variant: "ghost",
} as const
</script>

<template>
  <UTooltip :text="tip">
    <UButton v-if="noAgent" v-bind="button" @click="open = true">
      <span class="hidden sm:inline">Copy prompt</span>
    </UButton>
    <DropCopyButton v-else v-bind="button" :value="value">
      <span class="hidden sm:inline">Copy prompt</span>
    </DropCopyButton>
  </UTooltip>
  <UModal
    v-model:open="open"
    description="The prompt has your agent read this drop through Drop's MCP server, and no agent is connected to your account. Connect one, then paste the prompt into it."
    title="No agent connected"
  >
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <DropCopyButton color="neutral" icon="i-mingcute-copy-2-line" size="sm" :value="value" variant="ghost">
          Copy anyway
        </DropCopyButton>
        <UButton autofocus color="neutral" label="Connect an agent" size="sm" target="_blank" to="/agents" />
      </div>
    </template>
  </UModal>
</template>
