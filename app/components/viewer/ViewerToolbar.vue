<script setup lang="ts">
// The review toolbar, in Mesurer's look (packages/mesurer/components/toolbar): a borderless bar raised by layered
// shadows, 32px buttons in groups split by full-height hairlines, the tool that's on filled in the tools' one blue, and a
// black tooltip with the key after the name. It picks the tool the pointer has over the page (Browse, Comment, Measure)
// and what draws over it under any tool (rulers and guides, X-ray outlines, the comments' pins); the frame does the
// drawing (shared/plan-runtime.ts). A Markdown doc adds its reading width (`width`, the one showing), which W steps
// through too. Last, on pages, the size the page shows at (ViewerDeviceMenu). It centers under the page; the side panel
// sits beside it, not over it.
import type { ViewerOverlays, ViewerTool } from "~/composables/useViewerAnnotations"

const props = defineProps<{
  tool: ViewerTool
  overlays: ViewerOverlays
  canComment: boolean
  width?: string
  sizable: boolean
}>()
const emit = defineEmits<{ tool: [tool: ViewerTool]; toggle: [overlay: keyof ViewerOverlays]; width: [] }>()

type Item = { id: string; label: string; icon: string; kbd?: string; on: boolean; press: () => void }

const tools = computed<Item[]>(() =>
  [
    { value: "browse" as const, label: "Browse", icon: "i-mingcute-cursor-3-line", kbd: "V" },
    ...(props.canComment
      ? [{ value: "comment" as const, label: "Comment", icon: "i-mingcute-message-1-line", kbd: "R" }]
      : []),
    { value: "measure" as const, label: "Measure", icon: "i-mingcute-aiming-2-line", kbd: "S" },
  ].map((item) => ({
    id: item.value,
    label: item.label,
    icon: item.icon,
    kbd: item.kbd,
    on: props.tool === item.value,
    press: () => emit("tool", item.value),
  })),
)
const views = computed<Item[]>(() => [
  {
    id: "rulers",
    label: "Rulers and guides",
    icon: "i-mingcute-ruler-line",
    kbd: "U",
    on: props.overlays.rulers,
    press: () => emit("toggle", "rulers"),
  },
  {
    id: "xray",
    label: "X-ray",
    icon: "i-mingcute-layout-grid-line",
    kbd: "X",
    on: props.overlays.xray,
    press: () => emit("toggle", "xray"),
  },
  {
    // Pressed means hidden, like the others: pressed is the one that changes the page.
    id: "pins",
    label: "Hide comments",
    icon: props.overlays.pins ? "i-mingcute-eye-line" : "i-mingcute-eye-close-line",
    on: !props.overlays.pins,
    press: () => emit("toggle", "pins"),
  },
  ...(props.width
    ? [
        {
          id: "width",
          label: `Width: ${props.width}`,
          icon: "i-mingcute-spacing-horizontal-line",
          kbd: "W",
          on: false,
          press: () => emit("width"),
        },
      ]
    : []),
])
const groups = computed(() => [
  { label: "Tools", items: tools.value },
  { label: "Views", items: views.value },
])

// What the tool does, above the bar while it's on.
const hint = computed(() => {
  if (props.tool === "comment") return "Click an element to comment on it, or drag an area"
  if (props.tool === "measure") return "Click an element to pick it, then point at another for the distance"
  if (props.overlays.rulers) return "Drag a guide out of a ruler, and back to remove it"
  return ""
})
</script>

<template>
  <div
    class="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2 px-4 pb-[env(safe-area-inset-bottom)]"
  >
    <Transition
      enter-active-class="transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-opacity"
      enter-from-class="opacity-0 motion-safe:translate-y-1"
      leave-active-class="transition-opacity duration-100 ease-out"
      leave-to-class="opacity-0"
      mode="out-in"
    >
      <p
        v-if="hint"
        :key="hint"
        class="rounded-lg border border-transparent bg-default px-2.5 py-1 text-xs text-pretty text-muted shadow-toolbar"
      >
        {{ hint }}<kbd class="ml-1.5 font-sans text-dimmed">Esc</kbd>
      </p>
    </Transition>
    <!-- 10px outside, 6px buttons inside 4px of padding: concentric corners. The transparent border keeps an edge in
         forced-colors mode, which drops shadows. -->
    <div
      aria-label="Review tools"
      class="pointer-events-auto flex items-stretch rounded-[10px] border border-transparent bg-default shadow-toolbar"
      role="toolbar"
    >
      <template v-for="(group, index) in groups" :key="group.label">
        <div v-if="index" aria-hidden="true" class="w-px shrink-0 bg-(--ui-border)" />
        <div :aria-label="group.label" class="flex items-center gap-1 p-1" role="group">
          <UTooltip v-for="item in group.items" :key="item.id" :content="{ side: 'top', sideOffset: 8 }">
            <button
              :aria-keyshortcuts="item.kbd"
              :aria-label="item.label"
              :aria-pressed="item.on"
              class="grid size-8 place-items-center rounded-md outline-none select-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-tool/50 motion-safe:transition-[scale,background-color,color] motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.96]"
              :class="item.on ? 'bg-tool text-white' : 'text-highlighted hover:bg-elevated'"
              type="button"
              @click="item.press"
            >
              <UIcon aria-hidden="true" class="size-5" :name="item.icon" />
            </button>
            <template #content>
              {{ item.label }}<span v-if="item.kbd" class="ml-1.5 opacity-60">{{ item.kbd }}</span>
            </template>
          </UTooltip>
        </div>
      </template>
      <template v-if="sizable">
        <div aria-hidden="true" class="w-px shrink-0 bg-(--ui-border)" />
        <div aria-label="Device" class="flex items-center p-1" role="group">
          <ViewerDeviceMenu />
        </div>
      </template>
    </div>
  </div>
</template>
