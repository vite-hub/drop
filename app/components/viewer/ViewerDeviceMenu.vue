<script setup lang="ts">
// The review toolbar's Device button and its menu: the size the page shows at (ViewerDevice). Fill, then the devices
// with their sizes on the right, as in Chrome's device toolbar and T3 Code's; below them the width and height to type
// any size, and Rotate. A typed size that matches a device is that device.
import { DEVICE_MAX, DEVICE_MIN, DEVICES, type DeviceId, clampDevice, deviceOf } from "~/utils/devices"

const device = useDeviceSize()
const sized = computed(() => device.value.id !== "fill")
const icon = computed(() =>
  sized.value ? (deviceOf(device.value.id)?.icon ?? "i-mingcute-fullscreen-line") : "i-mingcute-device-line",
)

function pick(id: DeviceId) {
  const preset = deviceOf(id)
  if (!preset) return (device.value = { ...device.value, id })
  // A device keeps the way it was turned.
  const current = deviceOf(device.value.id)
  const rotated = current && device.value.width === current.height && device.value.width !== current.width
  device.value = rotated
    ? { id, width: preset.height, height: preset.width }
    : { id, width: preset.width, height: preset.height }
}
// The device with this size, either way up.
const matching = (width: number, height: number) =>
  DEVICES.find(
    (item) => (item.width === width && item.height === height) || (item.width === height && item.height === width),
  )?.id ?? "custom"
function resize(side: "width" | "height", value: number | null | undefined) {
  if (!value) return
  const next = { ...device.value, [side]: clampDevice(value) }
  device.value = { ...next, id: matching(next.width, next.height) }
}
function rotate() {
  device.value = { ...device.value, width: device.value.height, height: device.value.width }
}
const rows = computed(() => [
  { id: "fill" as const, label: "Fill", icon: "i-mingcute-device-line", size: "" },
  ...DEVICES.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    size: `${item.width} × ${item.height}`,
  })),
])
const inputUi = { base: "tabular-nums px-2" }
</script>

<template>
  <UPopover :content="{ side: 'top', sideOffset: 8 }">
    <UTooltip :content="{ side: 'top', sideOffset: 8 }" text="Device size">
      <button
        aria-label="Device size"
        :aria-pressed="sized"
        class="grid size-8 place-items-center rounded-md outline-none select-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-tool/50 motion-safe:transition-[scale,background-color,color] motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.96]"
        :class="sized ? 'bg-tool text-white' : 'text-highlighted hover:bg-elevated'"
        type="button"
      >
        <UIcon aria-hidden="true" class="size-5" :name="icon" />
      </button>
    </UTooltip>
    <template #content>
      <div class="w-64 p-1">
        <div aria-label="Device" class="flex flex-col" role="radiogroup">
          <button
            v-for="row in rows"
            :key="row.id"
            :aria-checked="device.id === row.id"
            class="flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-elevated focus-visible:bg-elevated"
            :class="device.id === row.id ? 'text-highlighted' : 'text-toned'"
            role="radio"
            type="button"
            @click="pick(row.id)"
          >
            <UIcon aria-hidden="true" class="size-4 shrink-0" :name="row.icon" />
            <span class="flex-1">{{ row.label }}</span>
            <span class="text-xs text-dimmed tabular-nums">{{ row.size }}</span>
            <UIcon
              aria-hidden="true"
              class="size-4 shrink-0 text-tool"
              :class="device.id === row.id ? '' : 'invisible'"
              name="i-mingcute-check-line"
            />
          </button>
        </div>
        <div class="mt-1 flex items-center gap-1.5 border-t border-default px-1 pt-2 pb-1">
          <UInputNumber
            aria-label="Width"
            class="w-20"
            :increment="false"
            :decrement="false"
            :max="DEVICE_MAX"
            :min="DEVICE_MIN"
            :model-value="sized ? device.width : undefined"
            placeholder="Width"
            size="sm"
            :ui="inputUi"
            @update:model-value="resize('width', $event)"
          />
          <span aria-hidden="true" class="text-xs text-dimmed">×</span>
          <UInputNumber
            aria-label="Height"
            class="w-20"
            :increment="false"
            :decrement="false"
            :max="DEVICE_MAX"
            :min="DEVICE_MIN"
            :model-value="sized ? device.height : undefined"
            placeholder="Height"
            size="sm"
            :ui="inputUi"
            @update:model-value="resize('height', $event)"
          />
          <UTooltip :content="{ side: 'top', sideOffset: 8 }" text="Rotate">
            <UButton
              aria-label="Rotate"
              class="ml-auto"
              color="neutral"
              :disabled="!sized"
              icon="i-mingcute-rotate-x-line"
              size="sm"
              variant="ghost"
              @click="rotate"
            />
          </UTooltip>
        </div>
      </div>
    </template>
  </UPopover>
</template>
