<script setup lang="ts">
import { DeviceFrame } from "vite-hub/ui"

const { on, bottom = 72 } = defineProps<{ on: boolean; bottom?: number }>()

const device = useDeviceSize()
</script>

<template>
  <DeviceFrame v-model="device" :disabled="!on" :inset-bottom="bottom">
    <slot />
  </DeviceFrame>
</template>
