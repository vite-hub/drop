<script setup lang="ts">
// A canvas of dots; the ones near the pointer grow and darken. Static under reduced motion.
const props = withDefaults(defineProps<{ gap?: number; radius?: number }>(), { gap: 22, radius: 140 })

const canvas = ref<HTMLCanvasElement | null>(null)
const colorMode = useColorMode()

onMounted(() => {
  const element = canvas.value
  const context = element?.getContext("2d")
  if (!element || !context) return
  const pointer = { x: -9999, y: -9999 }
  let frame = 0

  function draw() {
    frame = 0
    const { width, height } = element!.getBoundingClientRect()
    const ratio = window.devicePixelRatio || 1
    if (element!.width !== Math.round(width * ratio) || element!.height !== Math.round(height * ratio)) {
      element!.width = Math.round(width * ratio)
      element!.height = Math.round(height * ratio)
    }
    const base = colorMode.value === "dark" ? "255,255,255" : "0,0,0"
    context!.setTransform(ratio, 0, 0, ratio, 0, 0)
    context!.clearRect(0, 0, width, height)
    for (let x = props.gap / 2; x < width; x += props.gap) {
      for (let y = props.gap / 2; y < height; y += props.gap) {
        const near = Math.max(0, 1 - Math.hypot(x - pointer.x, y - pointer.y) / props.radius)
        context!.fillStyle = `rgba(${base},${0.1 + near * 0.45})`
        context!.beginPath()
        context!.arc(x, y, 1 + near * 1.6, 0, Math.PI * 2)
        context!.fill()
      }
    }
  }
  const schedule = () => (frame ||= requestAnimationFrame(draw))
  const move = (event: PointerEvent) => {
    const rect = element.getBoundingClientRect()
    pointer.x = event.clientX - rect.left
    pointer.y = event.clientY - rect.top
    schedule()
  }
  const leave = () => {
    pointer.x = pointer.y = -9999
    schedule()
  }

  draw()
  const observer = new ResizeObserver(schedule)
  observer.observe(element)
  const stopTheme = watch(() => colorMode.value, schedule)
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches
  if (!still) {
    window.addEventListener("pointermove", move, { passive: true })
    document.documentElement.addEventListener("pointerleave", leave)
  }

  onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    observer.disconnect()
    stopTheme()
    window.removeEventListener("pointermove", move)
    document.documentElement.removeEventListener("pointerleave", leave)
  })
})
</script>

<template>
  <canvas ref="canvas" aria-hidden="true" class="pointer-events-none" />
</template>
