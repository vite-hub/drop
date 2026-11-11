<script setup lang="ts">
// Device mode (ViewerDeviceButton turns it on), with ViteHub UI's DeviceFrame: Chrome's device bar above the page, and the
// page at exactly that many CSS pixels, fitted to the pane. The size lives in Drop's cookie, so every drop shares it. Off,
// the page fills the pane; the same elements render either way, so switching never reloads the page.
import { DeviceFrame } from "@vite-hub/ui/device-frame"

// `bottom` keeps the page clear of what floats under it, the review toolbar by default.
const { on, bottom = 72 } = defineProps<{ on: boolean; bottom?: number }>()

const device = useDeviceSize()
</script>

<template>
  <DeviceFrame v-model="device" :disabled="!on" :inset-bottom="bottom">
    <slot />
  </DeviceFrame>
</template>
