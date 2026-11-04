<script setup lang="ts">
// A prototype's state in the review dock's bar, in place of the bar its picker (skills/prototype) draws on a page alone.
// On the canvas: how many items, and the camera. In focus: the item showing with its note, a step either way, and the
// way back to the canvas. The page keeps the state and does the switching; this shows it and sends the reader's
// commands. While the page isn't focused, 1–9 open an item here too and ← → step in focus. The address's #v-… names
// the item in focus, as it does on the page alone, and opens it in focus on the next visit.
import type { PickerCommand, ViewerVariants } from "~/composables/useViewerFrame"

const props = defineProps<{ state: ViewerVariants }>()
const emit = defineEmits<{ command: [command: PickerCommand, index?: number] }>()
const group = useTemplateRef<HTMLElement>("group")
const shown = computed(() => props.state.variants[props.state.current]!)
const count = computed(() => props.state.variants.length)

const named = () => props.state.variants.findIndex((variant) => variant.id && `#${variant.id}` === location.hash)
let opened = false
watch(
  () => props.state,
  (state) => {
    if (!opened) {
      opened = true
      const at = named()
      if (at >= 0 && (state.canvas || at !== state.current)) return emit("command", "show", at)
    }
    if (!state.canvas && shown.value.id) {
      if (location.hash !== `#${shown.value.id}`) history.replaceState(history.state, "", `#${shown.value.id}`)
    } else if (state.canvas && named() >= 0)
      history.replaceState(history.state, "", location.pathname + location.search)
  },
  { immediate: true },
)

useEventListener("hashchange", () => {
  const at = named()
  if (at >= 0) emit("command", "show", at)
})

useEventListener("keydown", (event: KeyboardEvent) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target
  const inBar = target instanceof Node && Boolean(group.value?.contains(target))
  if (target !== document.body && !inBar) return
  const n = Number(event.key)
  if (/^[1-9]$/.test(event.key) && n <= count.value) emit("command", "show", n - 1)
  else if (props.state.canvas) return
  else if (event.key === "ArrowLeft") emit("command", "prev")
  else if (event.key === "ArrowRight") emit("command", "next")
  // Only from the bar: on the page, Escape is Drop's, which closes what's open first.
  else if (event.key === "Escape" && inBar) emit("command", "canvas")
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
  <div ref="group" aria-label="Prototype" class="flex max-w-full min-w-0 items-center gap-0.5" role="group">
    <template v-if="state.canvas">
      <UTooltip :content="{ side: 'top', sideOffset: 8 }" text="Double-click a name, or press 1–9, to open one">
        <span class="shrink-0 px-2 text-muted tabular-nums">{{ count }} items</span>
      </UTooltip>
      <span aria-hidden="true" class="mx-1 h-4 w-px shrink-0 bg-(--ui-border)" />
      <template v-for="(item, index) in camera" :key="item.command">
        <span v-if="index === 1" aria-live="polite" class="min-w-[5ch] shrink-0 text-center text-muted tabular-nums">
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
    </template>
    <template v-else>
      <UTooltip :content="{ side: 'top', sideOffset: 8 }" :kbds="['←']" text="Previous">
        <button
          aria-label="Previous"
          class="inline-flex shrink-0 items-center"
          type="button"
          @click="emit('command', 'prev')"
        >
          <UIcon aria-hidden="true" name="i-mingcute-left-line" />
        </button>
      </UTooltip>
      <span aria-live="polite" class="max-w-[44ch] min-w-0 truncate px-1" :title="shown.label || shown.id">
        {{ shown.label || shown.id }} <span class="text-muted tabular-nums">({{ state.current + 1 }}/{{ count }})</span>
      </span>
      <UTooltip :content="{ side: 'top', sideOffset: 8 }" :kbds="['→']" text="Next">
        <button
          aria-label="Next"
          class="inline-flex shrink-0 items-center"
          type="button"
          @click="emit('command', 'next')"
        >
          <UIcon aria-hidden="true" name="i-mingcute-right-line" />
        </button>
      </UTooltip>
      <UTooltip v-if="shown.note" :content="{ side: 'top', sideOffset: 8 }" :text="shown.note">
        <span class="hidden max-w-[64ch] min-w-0 truncate px-1 text-muted sm:block">{{ shown.note }}</span>
      </UTooltip>
      <span aria-hidden="true" class="mx-1 h-4 w-px shrink-0 bg-(--ui-border)" />
      <UTooltip :content="{ side: 'top', sideOffset: 8 }" :kbds="['Esc']" text="Every item side by side">
        <button class="inline-flex shrink-0 items-center" type="button" @click="emit('command', 'canvas')">
          Canvas
        </button>
      </UTooltip>
    </template>
  </div>
</template>
