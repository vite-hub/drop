<script setup lang="ts">
// Cycles through words with a short vertical slide. The first word paints still; nothing rotates under reduced motion.
const props = withDefaults(defineProps<{ words: string[]; interval?: number }>(), { interval: 2400 })

const index = ref(0)
const rotated = ref(false)
const motion = usePreferredReducedMotion()
const { pause, resume } = useIntervalFn(() => {
  rotated.value = true
  index.value = (index.value + 1) % props.words.length
}, () => props.interval, { immediate: false })
onMounted(() => watch(motion, value => (value === "reduce" ? pause() : resume()), { immediate: true }))
</script>

<template>
  <span class="relative inline-grid overflow-hidden pb-[0.08em] align-bottom">
    <span class="sr-only">{{ words.join(", ") }}</span>
    <!-- Every word sits invisibly in the same cell, so the slot is as wide as the widest one. -->
    <span v-for="word in words" :key="`size-${word}`" aria-hidden="true" class="invisible col-start-1 row-start-1">{{ word }}</span>
    <span
      :key="index"
      aria-hidden="true"
      class="col-start-1 row-start-1"
      :class="rotated && '[animation:word-in_480ms_var(--ease-out)]'"
    >{{ words[index] }}</span>
  </span>
</template>
