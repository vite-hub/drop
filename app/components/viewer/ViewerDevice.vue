<script setup lang="ts">
// Device mode (ViewerDeviceButton turns it on), after Chrome's device toolbar and Firefox's responsive mode. A bar above
// the page picks a device, takes any width and height, and rotates. Under it, Chrome's breakpoint bands set the width in
// one click, and rulers along the page's top and left edges count its pixels. The frame gets exactly that many CSS
// pixels, so the page's breakpoints see a phone. It's centered on a muted stage and scaled down when the pane is
// smaller, never up, as in T3 Code's preview. Its right, bottom, and corner edges drag to any size, and the size shows
// on the page while they do. Off, the page fills the pane as before. The same elements render either way, so switching
// never reloads the page.
import type { DropdownMenuItem } from "@nuxt/ui"
import {
  BREAKPOINTS,
  DEVICE_MAX,
  DEVICE_MIN,
  DEVICES,
  type DeviceSize,
  clampDevice,
  deviceMatching,
  deviceOf,
} from "~/utils/devices"

// `bottom` keeps the page clear of what floats under it, the review toolbar by default.
const props = withDefaults(defineProps<{ on: boolean; bottom?: number }>(), { bottom: 72 })

const device = useDeviceSize()
const sized = computed(() => props.on && device.value.on)
const preset = computed(() => deviceOf(device.value.id))
const set = (size: Pick<DeviceSize, "width" | "height">) =>
  (device.value = { on: true, ...size, id: deviceMatching(size.width, size.height) })

function pick(id: DeviceSize["id"]) {
  const next = deviceOf(id)
  if (!next) return
  // A device keeps the way it was turned.
  const turned = preset.value && device.value.width === preset.value.height && device.value.width !== preset.value.width
  device.value = turned
    ? { on: true, id, width: next.height, height: next.width }
    : { on: true, id, width: next.width, height: next.height }
}
const rotate = () => (device.value = { ...device.value, width: device.value.height, height: device.value.width })
function resize(side: "width" | "height", value: number | null | undefined) {
  if (value) set({ ...device.value, [side]: clampDevice(value) })
}
const items = computed<DropdownMenuItem[]>(() =>
  DEVICES.map((item) => ({
    label: item.label,
    icon: item.icon,
    size: `${item.width} × ${item.height}`,
    on: device.value.id === item.id,
    onSelect: () => pick(item.id),
  })),
)

const stage = useTemplateRef("stage")
const pane = useElementSize(stage)
// The stage's padding: the breakpoint bands, a gap, and the top ruler above the page; room for the left ruler beside it.
const BANDS = 20,
  RULER = 18,
  TOP = BANDS + 8 + RULER,
  SIDE = 28
const fit = computed(() =>
  Math.min(
    1,
    (pane.width.value - 2 * SIDE) / device.value.width,
    (pane.height.value - TOP - props.bottom) / device.value.height,
  ),
)
// Frozen while dragging, so the edge stays under the pointer; it fits again on release.
const held = ref<number | null>(null)
const scale = computed(() => Math.max(0.05, held.value ?? fit.value))

// Widest first, so each narrower band sits over the wider ones. A band's label goes in the strip it shows past the next
// narrower one, when that strip has room: the name and width, or the width alone.
const bands = computed(() =>
  BREAKPOINTS.map((band, index) => {
    const strip = ((band.width - (BREAKPOINTS[index - 1]?.width ?? 0)) * scale.value) / 2
    return {
      ...band,
      px: band.width * scale.value,
      text: strip >= 96 ? `${band.label} ${band.width}` : strip >= 32 ? String(band.width) : "",
      on: device.value.width === band.width,
    }
  }).reverse(),
)

// Ticks every `minor` pixels, at least 5 apart on screen, and a numbered one every `major`, at least 40 apart.
function ruler(length: number) {
  const s = scale.value
  const minor = [10, 20, 50, 100, 200, 500].find((step) => step * s >= 5) ?? 1000
  const major = [50, 100, 200, 500, 1000, 2000].find((step) => step * s >= 40 && step % minor === 0) ?? 5000
  return {
    minor: minor * s,
    marks: Array.from({ length: Math.floor(length / major) + 1 }, (_, index) => ({
      at: index * major * s,
      label: index * major,
    })),
  }
}
const across = computed(() => ruler(device.value.width))
const down = computed(() => ruler(device.value.height))

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
  set({
    width: edges.x ? clampDevice(start.width + (2 * (event.clientX - start.x)) / s) : device.value.width,
    height: edges.y ? clampDevice(start.height + (event.clientY - start.y) / s) : device.value.height,
  })
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
const inputUi = { base: "tabular-nums px-2 text-center" }
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col">
    <div
      v-if="sized"
      aria-label="Device"
      class="flex h-10 shrink-0 items-center gap-1.5 border-b border-default bg-default px-3"
      role="toolbar"
    >
      <UDropdownMenu :content="{ align: 'start' }" :items="items" :ui="{ content: 'w-56' }">
        <UButton
          color="neutral"
          :icon="preset?.icon ?? 'i-mingcute-device-line'"
          :label="preset?.label ?? 'Custom'"
          size="sm"
          trailing-icon="i-mingcute-down-small-line"
          variant="ghost"
        />
        <template #item-trailing="{ item }">
          <span class="text-xs text-dimmed tabular-nums">{{ item.size }}</span>
          <UIcon
            aria-hidden="true"
            class="size-4 text-tool"
            :class="item.on ? '' : 'invisible'"
            name="i-mingcute-check-line"
          />
        </template>
      </UDropdownMenu>
      <UInputNumber
        aria-label="Width"
        class="w-18"
        :decrement="false"
        :increment="false"
        :max="DEVICE_MAX"
        :min="DEVICE_MIN"
        :model-value="device.width"
        size="sm"
        :ui="inputUi"
        @update:model-value="resize('width', $event)"
      />
      <span aria-hidden="true" class="text-xs text-dimmed">×</span>
      <UInputNumber
        aria-label="Height"
        class="w-18"
        :decrement="false"
        :increment="false"
        :max="DEVICE_MAX"
        :min="DEVICE_MIN"
        :model-value="device.height"
        size="sm"
        :ui="inputUi"
        @update:model-value="resize('height', $event)"
      />
      <UButton
        color="neutral"
        :icon="
          device.width > device.height ? 'i-mingcute-rotate-to-vertical-line' : 'i-mingcute-rotate-to-horizontal-line'
        "
        label="Rotate"
        size="sm"
        variant="ghost"
        @click="rotate"
      />
      <span class="text-xs text-dimmed tabular-nums" title="Zoom to fit the pane">{{ Math.round(scale * 100) }}%</span>
      <UTooltip text="Leave device mode">
        <UButton
          aria-label="Leave device mode"
          class="ml-auto"
          color="neutral"
          icon="i-mingcute-close-line"
          size="sm"
          variant="ghost"
          @click="device = { ...device, on: false }"
        />
      </UTooltip>
    </div>

    <div
      ref="stage"
      class="relative flex min-h-0 flex-1 flex-col"
      :class="sized && 'items-center overflow-hidden bg-muted'"
      :style="sized ? { padding: `${TOP}px ${SIDE}px ${bottom}px` } : undefined"
    >
      <!-- Chrome's breakpoint bands, centered on the page like it. -->
      <div
        v-if="sized"
        aria-label="Breakpoints"
        class="absolute inset-x-0 top-0"
        role="group"
        :style="{ height: `${BANDS}px` }"
      >
        <button
          v-for="band in bands"
          :key="band.width"
          :aria-label="`${band.label}, ${band.width} pixels wide`"
          :aria-pressed="band.on"
          class="absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center justify-end border-x border-b border-default px-1.5 text-[10px] text-muted tabular-nums outline-none hover:bg-tool/15 hover:text-highlighted focus-visible:bg-tool/15"
          :class="band.on ? 'bg-tool/20 text-highlighted' : 'bg-accented/35'"
          :style="{ width: `${band.px}px` }"
          :title="`${band.label}: ${band.width}px`"
          type="button"
          @click="set({ width: band.width, height: device.height })"
        >
          {{ band.text }}
        </button>
      </div>

      <!-- The scaled page's footprint, which the stage centers; the page inside keeps its real size. -->
      <div
        class="relative flex min-h-0 flex-col"
        :class="sized ? 'shrink-0' : 'flex-1'"
        :style="sized ? { width: `${device.width * scale}px`, height: `${device.height * scale}px` } : undefined"
      >
        <template v-if="sized">
          <div
            aria-hidden="true"
            class="absolute inset-x-0 overflow-hidden border-b border-accented text-[9px] leading-none text-dimmed tabular-nums select-none"
            :style="{
              top: `-${RULER}px`,
              height: `${RULER}px`,
              backgroundImage: `repeating-linear-gradient(to right, var(--ui-border-accented) 0 1px, transparent 1px ${across.minor}px)`,
              backgroundSize: '100% 4px',
              backgroundPosition: 'bottom',
              backgroundRepeat: 'repeat-x',
            }"
          >
            <span
              v-for="mark in across.marks"
              :key="mark.label"
              class="absolute bottom-0 h-full border-l border-accented pt-0.5 pl-0.5"
              :style="{ left: `${mark.at}px` }"
              >{{ mark.label }}</span
            >
          </div>
          <div
            aria-hidden="true"
            class="absolute inset-y-0 overflow-hidden border-r border-accented text-[9px] leading-none text-dimmed tabular-nums select-none"
            :style="{
              left: `-${RULER}px`,
              width: `${RULER}px`,
              backgroundImage: `repeating-linear-gradient(to bottom, var(--ui-border-accented) 0 1px, transparent 1px ${down.minor}px)`,
              backgroundSize: '4px 100%',
              backgroundPosition: 'right',
              backgroundRepeat: 'repeat-y',
            }"
          >
            <span
              v-for="mark in down.marks"
              :key="mark.label"
              class="absolute right-0 w-full rotate-180 border-b border-accented pt-0.5 pl-0.5 [writing-mode:vertical-rl]"
              :style="{ top: `${mark.at}px` }"
              >{{ mark.label }}</span
            >
          </div>
        </template>
        <div
          class="flex min-h-0 flex-col"
          :class="[
            sized ? 'absolute top-0 left-0 origin-top-left overflow-hidden bg-default shadow-toolbar' : 'flex-1',
            held !== null && 'pointer-events-none',
          ]"
          :style="
            sized
              ? { width: `${device.width}px`, height: `${device.height}px`, transform: `scale(${scale})` }
              : undefined
          "
        >
          <slot />
        </div>
        <template v-if="sized">
          <p
            v-if="held !== null"
            class="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-md bg-inverted px-2 py-1 text-xs text-inverted tabular-nums shadow-toolbar"
          >
            {{ device.width }} × {{ device.height }}
          </p>
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
  </div>
</template>
