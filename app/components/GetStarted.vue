<script setup lang="ts">
// The first-run checklist on the Drops page. Every step ticks itself off from real data (connected agents, your drops),
// so it never asks you to confirm anything; it hides for good once the three main steps are done, or when dismissed.
// The dismissal is a cookie, read on the server too, so a dismissed checklist never flashes in.
import type { DropSummary } from "#shared/types"

const props = defineProps<{ drops: DropSummary[] }>()
const emit = defineEmits<{ upload: []; site: [] }>()

const hidden = useGetStartedHidden()
// Your agents decide only the first step, so they're fetched only when no drop came from one yet: on a Drops page with
// agents' drops the fetch only held up the render by another round trip.
const agents = hidden.value || props.drops.some((drop) => drop.actorKind === "agent") ? ref([]) : useAgentList().data
// On a team Drop a drop is the team's from the start, so sharing is done once there's one.
const { data: me } = useMe()
const team = computed(() => me.value?.mode === "team")

// Docs and apps count as a first drop; a folder or a site review alone has nothing to read yet.
const docs = computed(() => props.drops.filter((drop) => drop.kind !== "folder" && drop.kind !== "site"))
const steps = computed(() => [
  {
    id: "agent",
    title: "Connect an agent",
    hint: "Claude, Codex, Cursor, and more",
    done: agents.value.length > 0 || props.drops.some((drop) => drop.actorKind === "agent"),
  },
  { id: "drop", title: "Drop your first doc", hint: "Ask your agent, or upload a file", done: docs.value.length > 0 },
  {
    id: "share",
    title: team.value ? "Show it to the team" : "Share it",
    hint: team.value ? "Choose who sees each drop" : "Turn on a public link",
    done: props.drops.some((drop) => drop.share !== "private"),
  },
  {
    id: "site",
    title: "Review a live site",
    hint: "Comment on any website",
    done: props.drops.some((drop) => drop.kind === "site"),
    optional: true,
  },
])
const required = computed(() => steps.value.filter((step) => !step.optional))
const finished = computed(() => required.value.filter((step) => step.done).length)
const visible = computed(() => !hidden.value && finished.value < required.value.length)

// The first run is the whole page: the steps run down a column and the first open one starts expanded. Once there are
// drops the steps fold into a row of small cards above them, and each opens its instructions in a popover.
const picked = ref<string>()
const active = computed(() => {
  const step = steps.value.find((item) => item.id === picked.value)
  if (step) return step.done ? undefined : step.id
  return picked.value === undefined ? steps.value.find((item) => !item.done)?.id : undefined
})
const toggle = (id: string) => (picked.value = active.value === id ? "" : id)
const firstDoc = computed(() => docs.value[0])
const CARD_RING =
  "shadow-[0_0_0_1px_rgb(0_0_0/.07),0_1px_2px_rgb(0_0_0/.05)] dark:shadow-[0_0_0_1px_rgb(255_255_255/.09)]"
</script>

<template>
  <section v-if="visible && !drops.length" aria-labelledby="get-started" class="mx-auto max-w-2xl pt-4 pb-12 sm:pt-12">
    <header class="flex items-center gap-3">
      <h2 id="get-started" class="text-lg font-semibold text-highlighted">Get started</h2>
      <span class="text-sm text-muted tabular-nums">{{ finished }} of {{ required.length }} done</span>
      <UButton class="ml-auto" color="neutral" label="Hide" size="xs" variant="ghost" @click="hidden = true" />
    </header>
    <p class="mt-1 text-sm text-pretty text-muted">
      Your agents drop plans, specs, and small apps here, and you comment on them.
    </p>

    <ol class="mt-8">
      <li v-for="(step, index) in steps" :key="step.id" class="relative flex gap-4 pb-7 last:pb-0">
        <span
          v-if="index < steps.length - 1"
          aria-hidden="true"
          class="absolute top-8 bottom-2 left-3 w-px -translate-x-1/2 bg-(--ui-border)"
        />
        <span
          class="grid size-6 shrink-0 place-items-center rounded-full text-xs font-medium tabular-nums"
          :class="
            step.done
              ? 'bg-inverted text-inverted'
              : active === step.id
                ? 'text-highlighted ring-1 ring-(--ui-border-inverted)'
                : 'text-muted ring-1 ring-(--ui-border-accented)'
          "
        >
          <UIcon v-if="step.done" name="i-mingcute-check-line" class="size-3.5" />
          <template v-else>{{ index + 1 }}</template>
        </span>
        <div class="min-w-0 flex-1">
          <button
            :aria-expanded="active === step.id"
            class="flex h-6 items-center gap-2 text-left text-sm enabled:cursor-pointer"
            :class="
              step.done
                ? 'text-muted'
                : active === step.id
                  ? 'font-medium text-highlighted'
                  : 'font-medium text-default hover:text-highlighted'
            "
            :disabled="step.done"
            type="button"
            @click="toggle(step.id)"
          >
            {{ step.title }}
            <span v-if="step.optional" class="text-xs font-normal text-muted">Optional</span>
          </button>
          <GetStartedStep
            v-if="active === step.id"
            class="mt-2"
            :first-doc="firstDoc"
            :step="step.id"
            :team="team"
            @site="emit('site')"
            @upload="emit('upload')"
          />
        </div>
      </li>
    </ol>
  </section>

  <section v-else-if="visible" aria-labelledby="get-started" class="mb-8">
    <div class="mb-3 flex h-4 items-center gap-3">
      <h2 id="get-started" class="label-mono">Get started</h2>
      <span class="text-xs text-muted tabular-nums">{{ finished }} of {{ required.length }}</span>
      <UButton
        aria-label="Hide get started"
        class="ml-auto"
        color="neutral"
        icon="i-mingcute-close-line"
        size="xs"
        variant="ghost"
        @click="hidden = true"
      />
    </div>
    <ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <li v-for="step in steps" :key="step.id">
        <UPopover :content="{ align: 'start', sideOffset: 8 }">
          <button
            class="flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left transition-shadow duration-150 enabled:cursor-pointer enabled:hover:shadow-[0_0_0_1px_rgb(0_0_0/.12),0_2px_4px_rgb(0_0_0/.06)] dark:enabled:hover:shadow-[0_0_0_1px_rgb(255_255_255/.16)]"
            :class="CARD_RING"
            :disabled="step.done"
            type="button"
          >
            <UIcon v-if="step.done" name="i-mingcute-check-circle-fill" class="size-5 shrink-0 text-highlighted" />
            <UIcon v-else name="i-mingcute-round-line" class="size-5 shrink-0 text-dimmed" />
            <span class="min-w-0">
              <span class="block truncate text-sm" :class="step.done ? 'text-muted' : 'font-medium text-highlighted'">
                {{ step.title }}
              </span>
              <span class="block truncate text-xs text-muted">
                {{ step.done ? "Done" : step.optional ? `${step.hint} · Optional` : step.hint }}
              </span>
            </span>
          </button>
          <template #content>
            <div class="w-[min(34rem,calc(100vw-2rem))] p-4">
              <p class="mb-2 text-sm font-medium text-highlighted">{{ step.title }}</p>
              <GetStartedStep
                :first-doc="firstDoc"
                :step="step.id"
                :team="team"
                @site="emit('site')"
                @upload="emit('upload')"
              />
            </div>
          </template>
        </UPopover>
      </li>
    </ul>
  </section>
</template>
