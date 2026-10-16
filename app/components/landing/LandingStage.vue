<script setup lang="ts">
// A fixed-size canvas scaled down to fit its container, so scripted positions hold at any width.
// Phones get the compact canvas, which shows one window at a time.
const props = defineProps<{ size: [number, number]; compactSize: [number, number] }>()
defineSlots<{ default(props: { compact: boolean }): unknown }>()

const root = useTemplateRef<HTMLElement>("root")
const { width } = useElementSize(root)
const compact = useMediaQuery("(max-width: 639px)")
const canvas = computed(() => (compact.value ? props.compactSize : props.size))
const scale = computed(() => Math.min(1, width.value / canvas.value[0]))
</script>

<template>
  <div ref="root" class="relative mx-auto w-full" :style="{ maxWidth: `${canvas[0]}px`, aspectRatio: `${canvas[0]} / ${canvas[1]}` }">
    <div
      class="absolute top-0 left-0 origin-top-left"
      :class="!width && 'invisible'"
      :style="{ width: `${canvas[0]}px`, height: `${canvas[1]}px`, transform: `scale(${scale})` }"
    >
      <slot :compact="compact" />
    </div>
  </div>
</template>
