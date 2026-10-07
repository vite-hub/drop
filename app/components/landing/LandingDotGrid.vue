<script setup lang="ts">
// A canvas of dots; the ones near the pointer grow and darken. Static under reduced motion.
const props = withDefaults(defineProps<{ gap?: number; radius?: number }>(), { gap: 22, radius: 140 })

const canvas = useTemplateRef<HTMLCanvasElement>("canvas")
const colorMode = useColorMode()
const motion = usePreferredReducedMotion()
const pointer = { x: -9999, y: -9999 }

function draw() {
  const element = canvas.value
  const context = element?.getContext("2d")
  if (!element || !context) return
  const { width, height } = element.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
    element.width = Math.round(width * ratio)
    element.height = Math.round(height * ratio)
  }
  const base = colorMode.value === "dark" ? "255,255,255" : "0,0,0"
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  for (let x = props.gap / 2; x < width; x += props.gap) {
    for (let y = props.gap / 2; y < height; y += props.gap) {
      const near = Math.max(0, 1 - Math.hypot(x - pointer.x, y - pointer.y) / props.radius)
      context.fillStyle = `rgba(${base},${0.1 + near * 0.45})`
      context.beginPath()
      context.arc(x, y, 1 + near * 1.6, 0, Math.PI * 2)
      context.fill()
    }
  }
}

// One frame at most per animation tick, however fast the pointer moves.
const { resume: schedule } = useRafFn(draw, { once: true, immediate: false })

onMounted(schedule)
useResizeObserver(canvas, schedule)
watch(() => colorMode.value, schedule)
useEventListener(import.meta.client ? window : undefined, "pointermove", (event: PointerEvent) => {
  if (motion.value === "reduce" || !canvas.value) return
  const rect = canvas.value.getBoundingClientRect()
  pointer.x = event.clientX - rect.left
  pointer.y = event.clientY - rect.top
  schedule()
}, { passive: true })
useEventListener(import.meta.client ? document.documentElement : undefined, "pointerleave", () => {
  pointer.x = pointer.y = -9999
  schedule()
})
</script>

<template>
  <canvas ref="canvas" aria-hidden="true" class="pointer-events-none" />
</template>
