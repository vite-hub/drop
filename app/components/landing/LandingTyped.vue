<script setup lang="ts">
// Types its text out once, from when it mounts. All at once under reduced motion.
const { text, cps = 30, delay = 0 } = defineProps<{ text: string; cps?: number; delay?: number }>()
const count = ref(0)
const motion = usePreferredReducedMotion()
let started = 0
const { pause, resume } = useRafFn(() => {
  count.value = Math.max(0, Math.min(text.length, Math.floor(((performance.now() - started) / 1000) * cps)))
  if (count.value >= text.length) pause()
}, { immediate: false })
onMounted(() => {
  if (motion.value === "reduce") return void (count.value = text.length)
  started = performance.now() + delay
  resume()
})
</script>

<template>
  <span>{{ text.slice(0, count) }}</span>
</template>
