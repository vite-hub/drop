<script setup lang="ts">
// A prototype's variants in the review dock's bar, in place of the bar its picker (skills/prototype) draws on a page
// alone: previous, the numbered variants, next, the showing one's note, and the canvas with its camera. The page keeps
// the state and does the switching; this shows it and sends the reader's commands. ← → and 1–9 work here too while the
// page isn't focused, and the address's #v-… names the variant showing, as it does on the page alone.
import type { PickerCommand, ViewerVariants } from "~/composables/useViewerFrame"

const props = defineProps<{ state: ViewerVariants }>()
const emit = defineEmits<{ command: [command: PickerCommand, index?: number] }>()
const group = useTemplateRef<HTMLElement>("group")
const shown = computed(() => props.state.variants[props.state.current]!)
const name = (variant: { id: string; label: string }) => variant.label || variant.id

// The address opens the variant it names, then follows the one showing.
const named = () => props.state.variants.findIndex((variant) => variant.id && `#${variant.id}` === location.hash)
let opened = false
watch(
  () => props.state,
  (state) => {
    if (!opened) {
      opened = true
      const at = named()
      if (at >= 0 && at !== state.current) return emit("command", "show", at)
    }
    const { id } = shown.value
    if (id && location.hash !== `#${id}`) history.replaceState(history.state, "", `#${id}`)
  },
  { immediate: true },
)
watch(
  () => props.state.current,
  async () => {
    await nextTick()
    group.value
      ?.querySelector("[data-variant][aria-pressed=true]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" })
  },
)

useEventListener("hashchange", () => {
  const at = named()
  if (at >= 0) emit("command", "show", at)
})

useEventListener("keydown", (event: KeyboardEvent) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target
  if (target !== document.body && !(target instanceof Node && group.value?.contains(target))) return
  const n = Number(event.key)
  if (event.key === "ArrowLeft") emit("command", "prev")
  else if (event.key === "ArrowRight") emit("command", "next")
  else if (/^[1-9]$/.test(event.key) && n <= props.state.variants.length) emit("command", "show", n - 1)
  else return
  event.preventDefault()
})

const camera: { command: PickerCommand; label: string; icon?: string; kbd: string }[] = [
  { command: "zoom-out", label: "Zoom out", icon: "i-mingcute-zoom-out-line", kbd: "−" },
  { command: "zoom-in", label: "Zoom in", icon: "i-mingcute-zoom-in-line", kbd: "+" },
  { command: "fit", label: "Fit", kbd: "Shift 1" },
  { command: "reset", label: "Reset", kbd: "0" },
]
</script>

<template>
  <div ref="group" aria-label="Prototype variants" class="flex max-w-full min-w-0 items-center gap-1" role="group">
    <UTooltip :content="{ side: 'top', sideOffset: 8 }" :kbds="['←']" text="Previous variant">
      <button
        aria-label="Previous variant"
        class="inline-flex shrink-0 items-center"
        type="button"
        @click="emit('command', 'prev')"
      >
        <UIcon aria-hidden="true" name="i-mingcute-arrow-left-line" />
      </button>
    </UTooltip>
    <div class="flex min-w-0 gap-0.5 overflow-x-auto [scrollbar-width:none]">
      <UTooltip
        v-for="(variant, index) in state.variants"
        :key="variant.id || index"
        :content="{ side: 'top', sideOffset: 8 }"
        :disabled="!variant.note"
        :kbds="index < 9 ? [String(index + 1)] : undefined"
        :text="variant.note"
      >
        <button
          :aria-pressed="index === state.current"
          class="inline-flex shrink-0 items-center whitespace-nowrap"
          data-variant
          type="button"
          @click="emit('command', 'show', index)"
        >
          <span aria-hidden="true" class="tabular-nums opacity-60">{{ index + 1 }}</span
          >{{ name(variant) }}
        </button>
      </UTooltip>
    </div>
    <UTooltip :content="{ side: 'top', sideOffset: 8 }" :kbds="['→']" text="Next variant">
      <button
        aria-label="Next variant"
        class="inline-flex shrink-0 items-center"
        type="button"
        @click="emit('command', 'next')"
      >
        <UIcon aria-hidden="true" name="i-mingcute-arrow-right-line" />
      </button>
    </UTooltip>
    <span v-if="!state.canvas && shown.note" class="hidden max-w-[32ch] truncate px-2 text-muted lg:block">
      {{ shown.note }}
    </span>
    <div
      v-if="state.canvas"
      aria-label="Camera"
      class="flex shrink-0 items-center gap-0.5 border-l border-(--ui-border) pl-1"
      role="group"
    >
      <template v-for="(item, index) in camera" :key="item.command">
        <span v-if="index === 1" aria-live="polite" class="min-w-[5ch] text-center text-muted tabular-nums">
          {{ state.zoom }}%
        </span>
        <UTooltip :content="{ side: 'top', sideOffset: 8 }" :kbds="[item.kbd]" :text="item.label">
          <button
            :aria-label="item.icon ? item.label : undefined"
            class="inline-flex shrink-0 items-center"
            type="button"
            @click="emit('command', item.command)"
          >
            <UIcon v-if="item.icon" aria-hidden="true" :name="item.icon" />
            <template v-else>{{ item.label }}</template>
          </button>
        </UTooltip>
      </template>
    </div>
    <UTooltip :content="{ side: 'top', sideOffset: 8 }" text="Show every variant side by side">
      <button
        :aria-pressed="state.canvas"
        class="inline-flex shrink-0 items-center"
        type="button"
        @click="emit('command', 'canvas')"
      >
        Canvas
      </button>
    </UTooltip>
  </div>
</template>
