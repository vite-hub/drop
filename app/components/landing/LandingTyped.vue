<script setup lang="ts">
// Types its text out once, from when it mounts. All at once under reduced motion.
const props = withDefaults(defineProps<{ text: string; cps?: number; delay?: number }>(), { cps: 30, delay: 0 })
const count = ref(0)
const motion = usePreferredReducedMotion()
let started = 0
const { pause, resume } = useRafFn(() => {
  count.value = Math.max(0, Math.min(props.text.length, Math.floor(((performance.now() - started) / 1000) * props.cps)))
  if (count.value >= props.text.length) pause()
}, { immediate: false })
onMounted(() => {
  if (motion.value === "reduce") return void (count.value = props.text.length)
  started = performance.now() + props.delay
  resume()
})
</script>

<template>
  <span>{{ text.slice(0, count) }}</span>
</template>
