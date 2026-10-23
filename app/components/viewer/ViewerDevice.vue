<script setup lang="ts">
// Device mode (ViewerDeviceButton turns it on), after Chrome's device toolbar and Firefox's responsive mode. One bar above
// the page picks a device, takes any width and height, rotates, sets the width to one of Chrome's breakpoints in a click,
// and zooms. The frame gets exactly that many CSS pixels, so the page's breakpoints see a phone. It's centered on a
// muted stage and fits the pane by default, scaled down but never up, as in T3 Code's preview; a zoom typed or stepped
// replaces the fit, and a page bigger than the pane then scrolls. Size and zoom changes ease in. Its right, bottom, and
// corner edges drag to any size, and the size shows on the page while they do. Off, the page fills the pane as before.
// The same elements render either way, so switching never reloads the page.

// `bottom` keeps the page clear of what floats under it, the review toolbar by default.
const { on, bottom = 72 } = defineProps<{ on: boolean; bottom?: number }>()

const device = useDeviceSize()
const sized = computed(() => on && device.value.on)
const preset = computed(() => deviceOf(device.value.id))
const set = (size: Pick<DeviceSize, "width" | "height">) =>
  (device.value = { ...device.value, on: true, ...size, id: deviceMatching(size.width, size.height) })

function pick(id: DeviceSize["id"]) {
  const next = deviceOf(id)
  if (!next) return
  // A device keeps the way it was turned.
  const turned = preset.value && device.value.width === preset.value.height && device.value.width !== preset.value.width
  device.value = turned
    ? { ...device.value, id, width: next.height, height: next.width }
    : { ...device.value, id, width: next.width, height: next.height }
}
const rotate = () => (device.value = { ...device.value, width: device.value.height, height: device.value.width })
function resize(side: "width" | "height", value: number | null | undefined) {
  if (value) set({ ...device.value, [side]: clampDevice(value) })
}
const items = computed(() =>
  DEVICES.map((item) => ({
    label: item.label,
    icon: item.icon,
    size: `${item.width} × ${item.height}`,
    on: device.value.id === item.id,
    onSelect: () => pick(item.id),
  })),
)
// The breakpoint the width falls in shows, like a ruler's mark; the one it's exactly at is filled.
const within = computed(() => BREAKPOINTS.findLast((band) => band.width <= device.value.width)?.width)

const stage = useTemplateRef("stage")
const pane = useElementSize(stage)
// useElementSize reports the stage content box, which already excludes its device-mode padding.
const fit = computed(() => Math.min(1, pane.width.value / device.value.width, pane.height.value / device.value.height))
const fitting = computed(() => device.value.zoom == null)
// Frozen while dragging, so the edge stays under the pointer.
const held = ref<number | null>(null)
const scale = computed(() => Math.max(ZOOM_MIN, held.value ?? device.value.zoom ?? fit.value))
function zoom(value: number | null | undefined) {
  if (value) device.value = { ...device.value, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value)) }
}
const toFit = () => (device.value = { ...device.value, zoom: null })

let start: { x: number; y: number; width: number; height: number } | null = null
function grab(event: PointerEvent) {
  if (event.currentTarget instanceof Element) event.currentTarget.setPointerCapture(event.pointerId)
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
const sizeUi = { base: "tabular-nums px-2 text-center" }
const percent = { style: "percent", maximumFractionDigits: 0 } as const
</script>

<template>
  <div class="relative flex min-h-0 flex-1 flex-col">
    <div v-if="sized" class="@container shrink-0 border-b border-default bg-default">
      <div aria-label="Device" class="flex h-10 items-center gap-1.5 px-3" role="toolbar">
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
          class="w-16 shrink-0"
          :decrement="false"
          :increment="false"
          :max="DEVICE_MAX"
          :min="DEVICE_MIN"
          :model-value="device.width"
          size="sm"
          :ui="sizeUi"
          @update:model-value="resize('width', $event)"
        />
        <span aria-hidden="true" class="text-xs text-dimmed">×</span>
        <UInputNumber
          aria-label="Height"
          class="w-16 shrink-0"
          :decrement="false"
          :increment="false"
          :max="DEVICE_MAX"
          :min="DEVICE_MIN"
          :model-value="device.height"
          size="sm"
          :ui="sizeUi"
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

        <div aria-hidden="true" class="mx-1 hidden h-5 w-px bg-(--ui-border) @4xl:block" />
        <div aria-label="Breakpoints" class="hidden items-center gap-1 @4xl:flex" role="group">
          <UTooltip v-for="band in BREAKPOINTS" :key="band.width" :text="band.label">
            <button
              :aria-label="`${band.label}, ${band.width} pixels wide`"
              :aria-pressed="device.width === band.width"
              class="h-6 rounded-md border px-1.5 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-tool/50 motion-safe:transition-colors"
              :class="
                device.width === band.width
                  ? 'border-tool bg-tool text-white'
                  : within === band.width
                    ? 'border-accented bg-elevated text-highlighted'
                    : 'border-default text-muted hover:bg-elevated hover:text-highlighted'
              "
              type="button"
              @click="set({ width: band.width, height: device.height })"
            >
              {{ band.width }}
            </button>
          </UTooltip>
        </div>

        <div class="ml-auto flex items-center gap-1">
          <UInputNumber
            aria-label="Zoom"
            class="w-24 shrink-0"
            :format-options="percent"
            :max="ZOOM_MAX"
            :min="ZOOM_MIN"
            :model-value="scale"
            size="sm"
            :step="0.1"
            :ui="sizeUi"
            @update:model-value="zoom"
          />
          <UButton
            :aria-pressed="fitting"
            color="neutral"
            label="Fit"
            size="sm"
            :variant="fitting ? 'soft' : 'ghost'"
            @click="toFit"
          />
          <UTooltip text="Leave device mode">
            <UButton
              aria-label="Leave device mode"
              color="neutral"
              icon="i-mingcute-close-line"
              size="sm"
              variant="ghost"
              @click="device = { ...device, on: false }"
            />
          </UTooltip>
        </div>
      </div>
    </div>

    <!-- Scrolls when the zoom makes the page bigger than the pane; `mx-auto` centers it until then. -->
    <div
      ref="stage"
      class="relative flex min-h-0 flex-1 flex-col"
      :class="sized && 'overflow-auto bg-muted'"
      :style="sized ? { padding: `16px 24px ${bottom}px` } : undefined"
    >
      <!-- The scaled page's footprint; the page inside keeps its real size. -->
      <div
        class="relative flex min-h-0 flex-col"
        :class="[
          sized ? 'mx-auto shrink-0' : 'flex-1',
          sized &&
            held === null &&
            'motion-safe:transition-[width,height] motion-safe:duration-200 motion-safe:ease-out',
        ]"
        :style="sized ? { width: `${device.width * scale}px`, height: `${device.height * scale}px` } : undefined"
      >
        <div
          class="flex min-h-0 flex-col"
          :class="[
            sized ? 'absolute top-0 left-0 origin-top-left overflow-hidden bg-default shadow-toolbar' : 'flex-1',
            sized && held === null && 'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out',
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
