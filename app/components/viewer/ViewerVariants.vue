<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui"
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

let navigating = false
let clicked: EventTarget | null = null
useEventListener("keydown", (event: KeyboardEvent) => (navigating = /^(Tab|Arrow)/.test(event.key)), { capture: true })
useEventListener("pointerdown", () => (navigating = false), { capture: true })
useEventListener("focusin", (event: FocusEvent) => {
  clicked = !navigating && event.target instanceof HTMLButtonElement ? event.target : null
})
useEventListener("keydown", (event: KeyboardEvent) => {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target
  const inBar = target instanceof Node && Boolean(group.value?.contains(target))
  if (event.key === " " && props.state.canvas && (target === document.body || target === clicked)) {
    if (!holding) emit("command", "hold")
    holding = true
    return event.preventDefault()
  }
  if (target !== document.body && !inBar) return
  const n = Number(event.key)
  if (/^[1-9]$/.test(event.key) && n <= count.value) emit("command", "show", n - 1)
  else if (props.state.canvas) return
  else if (event.key === "ArrowLeft") emit("command", "prev")
  else if (event.key === "ArrowRight") emit("command", "next")
  else if (event.key === "Escape" && inBar) emit("command", "canvas")
  else return
  event.preventDefault()
})

let holding = false
const release = () => {
  if (holding) emit("command", "release")
  holding = false
}
useEventListener(
  "keyup",
  (event: KeyboardEvent) => {
    if (!holding || (event.key !== " " && event.key !== "Meta")) return
    if (event.key === " ") event.preventDefault()
    release()
  },
  { capture: true },
)
useEventListener("blur", release)
useEventListener(document, "visibilitychange", () => document.hidden && release())
onBeforeUnmount(release)

const tool = computed(() => props.state.tool ?? "move")
const zoomItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      type: "label",
      ui: { label: "font-normal text-muted", itemLabel: "whitespace-normal text-pretty" },
      label: `${count.value} items. Close this menu, then double-click a name or press 1–9 to open one.`,
    },
    { label: "Zoom in", icon: "i-mingcute-zoom-in-line", kbds: ["+"], onSelect: () => emit("command", "zoom-in") },
    { label: "Zoom out", icon: "i-mingcute-zoom-out-line", kbds: ["−"], onSelect: () => emit("command", "zoom-out") },
    { label: "Zoom to fit", kbds: ["shift", "1"], onSelect: () => emit("command", "fit") },
    { label: "Zoom to 100%", kbds: ["0"], onSelect: () => emit("command", "reset") },
    { label: "Reset layout", onSelect: () => emit("command", "layout") },
  ],
  [
    {
      type: "checkbox",
      label: "Hand tool",
      kbds: ["H"],
      checked: tool.value === "hand",
      onSelect: () => emit("command", tool.value === "hand" ? "move" : "hand"),
    },
  ],
])
</script>

<template>
  <div
    ref="group"
    aria-label="Prototype"
    :data-review-canvas="state.canvas || undefined"
    class="flex max-w-full min-w-0 items-center gap-0.5"
    role="group"
  >
    <template v-if="state.canvas">
      <UTooltip
        v-if="tool === 'hand'"
        :content="{ side: 'top', sideOffset: 8 }"
        :kbds="['V']"
        text="Hand: drag anywhere to pan. Press to put it down"
      >
        <button
          aria-keyshortcuts="H"
          aria-label="Hand"
          aria-pressed="true"
          data-review-hand
          class="inline-flex shrink-0 items-center"
          type="button"
          @click="emit('command', 'move')"
        >
          <UIcon aria-hidden="true" name="i-mingcute-hand-line" />
        </button>
      </UTooltip>
      <UDropdownMenu :content="{ side: 'top', sideOffset: 10 }" :items="zoomItems" :ui="{ content: 'w-60' }">
        <button
          :aria-label="`Zoom, ${state.zoom}%`"
          data-review-zoom
          class="inline-flex shrink-0 items-center gap-0.5 tabular-nums"
          type="button"
        >
          <span aria-live="polite">{{ state.zoom }}%</span>
          <UIcon aria-hidden="true" name="i-mingcute-down-small-line" />
        </button>
      </UDropdownMenu>
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
