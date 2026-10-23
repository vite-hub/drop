<script setup lang="ts">
// The page at a device's size (the review toolbar's Device menu): the frame gets that many CSS pixels, so the page's
// breakpoints see a phone or a laptop, centered on a muted stage and scaled down when the pane is smaller, never up, like
// Chrome's device mode and T3 Code's preview. Its right, bottom, and corner edges drag to any size. Under `fill` the
// page fills the pane as before. The same elements render either way, so switching never reloads the page.
import { clampDevice, deviceOf } from "~/utils/devices"

// `bottom` keeps the page clear of what floats under it, the review toolbar by default.
const props = withDefaults(defineProps<{ on: boolean; bottom?: number }>(), { bottom: 72 })

const device = useDeviceSize()
const sized = computed(() => props.on && device.value.id !== "fill")
const stage = useTemplateRef("stage")
const pane = useElementSize(stage)
// The stage's padding: room for the size above the page.
const SIDE = 24,
  TOP = 36
const fit = computed(() =>
  Math.min(
    1,
    (pane.width.value - 2 * SIDE) / device.value.width,
    (pane.height.value - TOP - props.bottom) / device.value.height,
  ),
)
// Frozen while dragging, so the edge stays under the pointer; it fits again on release.
const held = ref<number | null>(null)
const scale = computed(() => Math.max(0.1, held.value ?? fit.value))
const label = computed(() => deviceOf(device.value.id)?.label ?? "Custom")

let start: { x: number; y: number; width: number; height: number } | null = null
function grab(event: PointerEvent) {
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
  start = { x: event.clientX, y: event.clientY, width: device.value.width, height: device.value.height }
  held.value = scale.value
}
// The page is centered, so its right edge moves half as far as its width grows.
function drag(event: PointerEvent, edges: { x?: boolean; y?: boolean }) {
  if (!start) return
  const s = scale.value
  device.value = {
    id: "custom",
    width: edges.x ? clampDevice(start.width + (2 * (event.clientX - start.x)) / s) : device.value.width,
    height: edges.y ? clampDevice(start.height + (event.clientY - start.y) / s) : device.value.height,
  }
}
function release() {
  start = null
  held.value = null
}
// A grip on each side, as in Chrome's device mode; the corner has none.
const HANDLES = [
  {
    edges: { x: true },
    class: "-right-3 top-0 h-full w-3 cursor-ew-resize",
    grip: "h-8 w-1",
    label: "Drag to change the width",
  },
  {
    edges: { y: true },
    class: "-bottom-3 left-0 h-3 w-full cursor-ns-resize",
    grip: "h-1 w-8",
    label: "Drag to change the height",
  },
  { edges: { x: true, y: true }, class: "-right-3 -bottom-3 size-3 cursor-nwse-resize", label: "Drag to resize" },
]
</script>

<template>
  <div
    ref="stage"
    class="relative flex min-h-0 flex-1 flex-col"
    :class="sized && 'items-center overflow-hidden bg-muted'"
    :style="sized ? { padding: `${TOP}px ${SIDE}px ${bottom}px` } : undefined"
  >
    <p
      v-if="sized"
      class="absolute inset-x-0 top-0 flex h-9 items-center justify-center gap-1.5 text-xs text-muted tabular-nums"
    >
      <span class="text-toned">{{ label }}</span>
      <span>{{ device.width }} × {{ device.height }}</span>
      <span v-if="scale < 1" class="text-dimmed">{{ Math.round(scale * 100) }}%</span>
    </p>
    <!-- The scaled page's footprint, which the stage centers; the page inside keeps its real size. -->
    <div
      class="relative flex min-h-0 flex-col"
      :class="sized ? 'shrink-0' : 'flex-1'"
      :style="sized ? { width: `${device.width * scale}px`, height: `${device.height * scale}px` } : undefined"
    >
      <div
        class="flex min-h-0 flex-col"
        :class="[
          sized
            ? 'absolute top-0 left-0 origin-top-left overflow-hidden rounded-md bg-default shadow-toolbar'
            : 'flex-1',
          held !== null && 'pointer-events-none',
        ]"
        :style="
          sized ? { width: `${device.width}px`, height: `${device.height}px`, transform: `scale(${scale})` } : undefined
        "
      >
        <slot />
      </div>
      <template v-if="sized">
        <div
          v-for="handle in HANDLES"
          :key="handle.class"
          :aria-label="handle.label"
          class="group absolute grid touch-none place-items-center"
          :class="handle.class"
          role="separator"
          @lostpointercapture="release"
          @pointerdown="grab"
          @pointermove="drag($event, handle.edges)"
        >
          <span
            v-if="handle.grip"
            class="rounded-full bg-accented group-hover:bg-inverted/40"
            :class="[handle.grip, held !== null && 'bg-inverted/40']"
          />
        </div>
      </template>
    </div>
  </div>
</template>
