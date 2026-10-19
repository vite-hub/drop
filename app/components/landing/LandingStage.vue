<script setup lang="ts">
// A fixed-size canvas scaled down to fit its container, so scripted positions hold at any width.
// Phones get the compact canvas, which shows one window at a time. `grow` lets it scale up past its size on wide screens.
// The server assumes a laptop (as useViewerPanel does), and hydration keeps that until mounted, so the two agree.
const props = withDefaults(defineProps<{ size: [number, number]; compactSize: [number, number]; grow?: number }>(), { grow: 1 })

const root = useTemplateRef<HTMLElement>("root")
const { width } = useElementSize(root)
const compact = useMediaQuery("(max-width: 639px)", { ssrWidth: 1280 })
provide(STAGE_COMPACT, compact)
const canvas = computed(() => (compact.value ? props.compactSize : props.size))
const scale = computed(() => Math.min(props.grow, width.value / canvas.value[0]))
</script>

<template>
  <div ref="root" class="relative mx-auto w-full" :style="{ maxWidth: `${canvas[0] * grow}px`, aspectRatio: `${canvas[0]} / ${canvas[1]}` }">
    <div
      class="absolute top-0 left-0 origin-top-left"
      :class="!width && 'invisible'"
      :style="{ width: `${canvas[0]}px`, height: `${canvas[1]}px`, transform: `scale(${scale})` }"
    >
      <slot />
    </div>
  </div>
</template>
