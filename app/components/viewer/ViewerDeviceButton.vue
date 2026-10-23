<script setup lang="ts">
// Device mode's switch, in the review toolbar under docs, apps, and reviewed sites. On, the page shows at the last device
// or size picked, with the device bar above it (ViewerDevice); off, it fills the pane again.
const device = useDeviceSize()
const toggle = () => (device.value = { ...device.value, on: !device.value.on })
</script>

<template>
  <UTooltip :content="{ side: 'top', sideOffset: 8 }">
    <button
      aria-label="Device mode"
      :aria-pressed="device.on"
      class="grid size-8 place-items-center rounded-md outline-none select-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-tool/50 motion-safe:transition-[scale,background-color,color] motion-safe:duration-150 motion-safe:ease-out motion-safe:active:scale-[0.96]"
      :class="device.on ? 'bg-tool text-white' : 'text-highlighted hover:bg-elevated'"
      type="button"
      @click="toggle"
    >
      <UIcon aria-hidden="true" class="size-5" name="i-mingcute-device-line" />
    </button>
    <template #content>Device mode</template>
  </UTooltip>
</template>
