<script setup lang="ts">
// The first-run checklist on the Drops page. Every step ticks itself off from real data (connected agents, your drops),
// so it never asks you to confirm anything; it hides for good once the three main steps are done, or when dismissed.
// The dismissal is a cookie, read on the server too, so a dismissed checklist never flashes in.
import type { DropSummary } from "#shared/types"

const props = defineProps<{ drops: DropSummary[] }>()
const emit = defineEmits<{ upload: []; site: [] }>()

const hidden = useGetStartedHidden()
const { agents } = useAgents()
const origin = useRequestURL().origin
const snippets = mcpSnippets(`${origin}/mcp`)
const clients = MCP_CLIENT_IDS.map((value) => ({ label: MCP_CLIENTS[value], value }))
const client = ref<McpClient>("claude")
const PROMPT = "Write a one-page plan for what we're building next and drop it for review."
// On a team Drop a drop is the team's from the start, so sharing is done once there's one.
const { data: me } = useMe()
const team = computed(() => me.value?.mode === "team")

// Docs and apps count as a first drop; a folder or a site review alone has nothing to read yet.
const docs = computed(() => props.drops.filter((drop) => drop.kind !== "folder" && drop.kind !== "site"))
const steps = computed(() => [
  {
    id: "agent",
    title: "Connect an agent",
    done: agents.value.length > 0 || props.drops.some((drop) => drop.actorKind === "agent"),
  },
  { id: "drop", title: "Drop your first doc", done: docs.value.length > 0 },
  {
    id: "share",
    title: team.value ? "Show it to the team" : "Share it",
    done: props.drops.some((drop) => drop.share !== "private"),
  },
  { id: "site", title: "Review a live site", done: props.drops.some((drop) => drop.kind === "site"), optional: true },
])
const required = computed(() => steps.value.filter((step) => !step.optional))
const finished = computed(() => required.value.filter((step) => step.done).length)
const visible = computed(() => !hidden.value && finished.value < required.value.length)

// On an empty page the first open step starts expanded. Once there are drops the list starts folded, a few short
// rows above your drops, and a step opens on click. A step that gets done closes.
const picked = ref<string>()
const active = computed(() => {
  const step = steps.value.find((item) => item.id === picked.value)
  if (step) return step.done ? undefined : step.id
  return picked.value === undefined && !props.drops.length ? steps.value.find((item) => !item.done)?.id : undefined
})
const toggle = (id: string) => (picked.value = active.value === id ? "" : id)
const firstDoc = computed(() => docs.value[0])

const tabsUi = {
  list: "w-auto",
  indicator: "bg-default shadow-xs ring ring-default",
  trigger: "text-xs data-[state=active]:text-highlighted",
}
</script>

<template>
  <section v-if="visible" aria-labelledby="get-started" class="mb-6 rounded-lg border border-default">
    <header class="flex items-center gap-3 border-b border-default py-2 pr-2 pl-4">
      <h2 id="get-started" class="text-sm font-medium text-highlighted">Get started</h2>
      <span class="text-xs text-muted tabular-nums">{{ finished }} of {{ required.length }} done</span>
      <UButton
        aria-label="Hide get started"
        class="ml-auto"
        color="neutral"
        icon="i-ph-x"
        size="xs"
        variant="ghost"
        @click="hidden = true"
      />
    </header>

    <ol class="divide-y divide-default">
      <li v-for="step in steps" :key="step.id">
        <button
          :aria-expanded="active === step.id"
          class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors enabled:cursor-pointer enabled:hover:bg-muted"
          :disabled="step.done"
          type="button"
          @click="toggle(step.id)"
        >
          <UIcon v-if="step.done" name="i-ph-check-circle-fill" class="size-5 shrink-0 text-highlighted" />
          <UIcon v-else name="i-ph-circle" class="size-5 shrink-0 text-dimmed" />
          <span class="text-sm" :class="step.done ? 'text-muted line-through' : 'font-medium text-highlighted'">{{
            step.title
          }}</span>
          <span v-if="step.optional" class="text-xs text-muted">Optional</span>
          <UIcon
            v-if="!step.done"
            name="i-ph-caret-down"
            class="ml-auto size-4 text-dimmed transition-transform"
            :class="active === step.id && 'rotate-180'"
          />
        </button>

        <div v-if="active === step.id" class="space-y-3 pr-4 pb-4 pl-12 text-sm text-muted">
          <template v-if="step.id === 'agent'">
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

          <template v-else-if="step.id === 'drop'">
            <p>
              Ask your agent for something to review. It answers with the link, and the drop lands here, private to you.
            </p>
            <AgentsCodeBlock :code="PROMPT" />
            <p class="flex flex-wrap items-center gap-2">
              Or drop a Markdown, HTML, or image file yourself.
              <UButton
                color="neutral"
                icon="i-ph-upload-simple"
                label="Upload a file"
                size="xs"
                variant="outline"
                @click="emit('upload')"
              />
            </p>
          </template>

          <template v-else-if="step.id === 'share'">
            <p v-if="team">
              Your team sees what you drop, and comments on it. Press Share to keep one to yourself, let the team edit
              it, or open a public link for people outside.
            </p>
            <p v-else>
              Everything starts private. Open a drop and press Share to turn on a public link, and choose whether people
              with it can comment.
            </p>
            <UButton
              v-if="firstDoc"
              color="neutral"
              :label="`Open ${firstDoc.title}`"
              size="xs"
              :to="`/drops/${firstDoc.id}`"
              trailing-icon="i-ph-arrow-right"
              variant="outline"
            />
            <p v-else>Drop something first.</p>
          </template>

          <template v-else>
            <p>
              Comment on any live website, such as a preview build, with a bookmarklet. Each note arrives with a
              screenshot your agent can read.
            </p>
            <UButton
              color="neutral"
              icon="i-ph-globe-simple"
              label="New Site Review"
              size="xs"
              variant="outline"
              @click="emit('site')"
            />
          </template>
        </div>
      </li>
    </ol>
  </section>
</template>
