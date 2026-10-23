<script setup lang="ts">
// The review toolbar, Mesurer's floating pill under the page: the tool the pointer has over it (Browse, Comment,
// Measure) and what draws over it under any tool (rulers and guides, X-ray outlines, the comments' pins). The frame does
// the drawing (shared/plan-runtime.ts); this only picks. It centers on the room the floating panel leaves (`inset`).
import type { ViewerOverlays, ViewerTool } from "~/composables/useViewerAnnotations"

const props = defineProps<{ tool: ViewerTool; overlays: ViewerOverlays; canComment: boolean; inset: number }>()
const emit = defineEmits<{ tool: [tool: ViewerTool]; toggle: [overlay: keyof ViewerOverlays] }>()

const tools = computed(() => [
  { value: "browse" as const, label: "Browse", icon: "i-mingcute-cursor-3-line", kbd: "v" },
  ...(props.canComment
    ? [{ value: "comment" as const, label: "Comment", icon: "i-mingcute-message-1-line", kbd: "r" }]
    : []),
  { value: "measure" as const, label: "Measure", icon: "i-mingcute-aiming-2-line", kbd: "s" },
])
const toggles = computed(() => [
  {
    value: "rulers" as const,
    label: props.overlays.rulers ? "Hide rulers" : "Rulers and guides",
    icon: "i-mingcute-ruler-line",
    kbd: "u",
    on: props.overlays.rulers,
  },
  {
    value: "xray" as const,
    label: props.overlays.xray ? "Turn off X-ray" : "X-ray",
    icon: "i-mingcute-layout-grid-line",
    kbd: "x",
    on: props.overlays.xray,
  },
  {
    value: "pins" as const,
    label: props.overlays.pins ? "Hide comments" : "Show comments",
    icon: props.overlays.pins ? "i-mingcute-eye-line" : "i-mingcute-eye-close-line",
    kbd: undefined,
    on: !props.overlays.pins,
  },
])
// What the tool does, above the pill while it's on.
const hint = computed(() => {
  if (props.tool === "comment") return "Click an element to comment on it, or drag an area"
  if (props.tool === "measure") return "Click an element to pick it, then point at another for the distance"
  if (props.overlays.rulers) return "Drag a guide out of a ruler; drag it back to remove it"
  return ""
})
</script>

<template>
  <div
    class="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2 px-4"
    :style="{ paddingRight: `${inset + 16}px` }"
  >
    <p
      v-if="hint"
      :key="hint"
      class="rounded-full border border-default bg-default/95 px-3 py-1 text-xs text-muted shadow-sm [animation:pop-in_140ms_var(--ease-out)]"
    >
      {{ hint }}<span class="ml-1 text-dimmed">· Esc</span>
    </p>
    <div
      aria-label="Review tools"
      class="pointer-events-auto flex items-center gap-0.5 rounded-full border border-default bg-default p-1 shadow-lg shadow-black/5"
      role="toolbar"
    >
      <UTooltip v-for="item in tools" :key="item.value" :kbds="[item.kbd]" :text="item.label">
        <UButton
          :aria-label="item.label"
          :aria-pressed="tool === item.value"
          class="rounded-full"
          color="neutral"
          :icon="item.icon"
          size="sm"
          :variant="tool === item.value ? 'solid' : 'ghost'"
          @click="emit('tool', item.value)"
        />
      </UTooltip>
      <USeparator class="mx-1 h-5" orientation="vertical" />
      <UTooltip v-for="item in toggles" :key="item.value" :kbds="item.kbd ? [item.kbd] : undefined" :text="item.label">
        <UButton
          :aria-label="item.label"
          :aria-pressed="item.on"
          class="rounded-full"
          color="neutral"
          :icon="item.icon"
          size="sm"
          :variant="item.on ? 'soft' : 'ghost'"
          @click="emit('toggle', item.value)"
        />
      </UTooltip>
    </div>
  </div>
</template>
