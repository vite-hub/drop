<script setup lang="ts">
// The viewer's details in the review pill: ⓘ (I) slides open a segment inside the pill. A chip with the size and
// views opens the details (#details) in a popover, the version chip (H) opens History (#history), the width button (W)
// steps the reading width, and the drop's actions follow as icons with tooltips. The two chips show their words, so
// they have no tooltip (one inside a popover's trigger loses its provider). Escape closes the popover first,
// then the segment. On a phone the segment takes its own rows above the pill's, wrapping rather than hiding anything.
export type DetailsAction = {
  id: string
  label: string
  icon: string
  kbd?: string
  destructive?: boolean
  to?: string | { path: string; query?: Record<string, string> }
  press?: () => void
}

const open = defineModel<boolean>("open", { required: true })
const pop = defineModel<"meta" | "history" | null>("pop", { required: true })
const props = defineProps<{
  meta: string
  version?: string
  width?: string
  actions: DetailsAction[]
}>()
const emit = defineEmits<{ width: [] }>()

const popOpen = (name: "meta" | "history") =>
  computed({
    get: () => open.value && pop.value === name,
    set: (value: boolean) => (pop.value = value ? name : pop.value === name ? null : pop.value),
  })
const metaOpen = popOpen("meta")
const historyOpen = popOpen("history")
const main = computed(() => props.actions.filter((action) => !action.destructive))
const danger = computed(() => props.actions.filter((action) => action.destructive))
watch(open, (value) => !value && (pop.value = null))

const chip =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-toned tabular-nums transition-colors hover:bg-elevated hover:text-highlighted aria-expanded:bg-inverted aria-expanded:text-inverted focus-visible:outline-2 focus-visible:outline-inverted active:scale-96 motion-reduce:active:scale-100"
const square =
  "grid size-7 shrink-0 place-items-center rounded-md text-toned transition-colors hover:bg-elevated hover:text-highlighted focus-visible:outline-2 focus-visible:outline-inverted active:scale-96 motion-reduce:active:scale-100"
const popoverUi = {
  content: "w-[min(24rem,calc(100vw-1rem))] max-h-[min(32rem,70dvh)] overflow-y-auto overscroll-contain",
}
</script>

<template>
  <UTooltip text="Details" :kbds="['I']" :content="{ side: 'top', sideOffset: 8 }">
    <button
      aria-controls="drop-details"
      :aria-expanded="open"
      aria-keyshortcuts="I"
      aria-label="Details"
      :class="[square, open && 'bg-inverted text-inverted hover:bg-inverted hover:text-inverted']"
      type="button"
      @click="open = !open"
    >
      <UIcon name="i-mingcute-information-line" class="size-4" />
    </button>
  </UTooltip>
  <!-- Grows from nothing beside ⓘ: the column eases open, then its buttons fade in. A phone gives it a row of its own. -->
  <div
    id="drop-details"
    class="grid min-w-0 transition-[grid-template-columns] duration-250 ease-[cubic-bezier(.23,1,.32,1)] motion-reduce:transition-none max-sm:order-first max-sm:basis-full"
    :class="open ? 'grid-cols-[1fr]' : 'grid-cols-[0fr] max-sm:hidden'"
    :inert="!open"
    role="group"
    aria-label="Details and actions"
  >
    <div
      class="flex min-w-0 items-center gap-0.5 overflow-hidden transition-opacity duration-150 motion-reduce:transition-none max-sm:flex-wrap max-sm:justify-center max-sm:pb-0.5"
      :class="open ? 'opacity-100 delay-75' : 'opacity-0'"
    >
      <span aria-hidden="true" class="mx-1 h-4 w-px shrink-0 bg-(--ui-border) max-sm:hidden" />
      <UPopover v-model:open="metaOpen" :content="{ side: 'top', sideOffset: 10 }" :ui="popoverUi">
        <button aria-label="Details" :class="chip" type="button">
          <UIcon name="i-mingcute-document-2-line" class="size-3.5" />{{ meta }}
        </button>
        <template #content><slot name="details" /></template>
      </UPopover>
      <UPopover v-if="version" v-model:open="historyOpen" :content="{ side: 'top', sideOffset: 10 }" :ui="popoverUi">
        <button aria-keyshortcuts="H" :aria-label="`History, ${version}`" :class="chip" type="button">
          <UIcon name="i-mingcute-history-line" class="size-3.5" />{{ version }}
        </button>
        <template #content><slot name="history" /></template>
      </UPopover>
      <UTooltip v-if="width" text="Reading width" :kbds="['W']" :content="{ side: 'top', sideOffset: 8 }">
        <button aria-keyshortcuts="W" :class="chip" type="button" @click="emit('width')">
          <UIcon name="i-mingcute-text-line" class="size-3.5" /><span class="sr-only">Reading width: </span>{{ width }}
        </button>
      </UTooltip>
      <span v-if="main.length" aria-hidden="true" class="w-1 shrink-0" />
      <UTooltip
        v-for="action in main"
        :key="action.id"
        :text="action.label"
        :kbds="action.kbd ? [action.kbd] : undefined"
        :content="{ side: 'top', sideOffset: 8 }"
      >
        <NuxtLink v-if="action.to" :aria-label="action.label" :class="square" :to="action.to">
          <UIcon :name="action.icon" class="size-4" />
        </NuxtLink>
        <button v-else :aria-label="action.label" :class="square" type="button" @click="action.press?.()">
          <UIcon :name="action.icon" class="size-4" />
        </button>
      </UTooltip>
      <template v-if="danger.length">
        <span aria-hidden="true" class="mx-1 h-4 w-px shrink-0 bg-(--ui-border)" />
        <UTooltip
          v-for="action in danger"
          :key="action.id"
          :text="action.label"
          :content="{ side: 'top', sideOffset: 8 }"
        >
          <button
            :aria-label="action.label"
            :class="[square, 'hover:text-error']"
            type="button"
            @click="action.press?.()"
          >
            <UIcon :name="action.icon" class="size-4" />
          </button>
        </UTooltip>
      </template>
    </div>
  </div>
</template>
