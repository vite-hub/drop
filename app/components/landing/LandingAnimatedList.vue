<script setup lang="ts" generic="T">
// Items arrive one at a time at the top and push the rest down, forever.
// Starts full: only new arrivals animate, never the first paint. Holds still under reduced motion.
const props = withDefaults(defineProps<{ items: T[]; visible?: number; interval?: number }>(), { visible: 4, interval: 2200 })
defineSlots<{ default(props: { item: T }): unknown }>()

const count = ref(props.visible)
let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
  timer = setInterval(() => count.value++, props.interval)
})
onBeforeUnmount(() => clearInterval(timer))

const arrived = computed(() => count.value > props.visible)
const shown = computed(() =>
  Array.from({ length: Math.min(count.value, props.visible + 1) }, (_, offset) => {
    const n = count.value - 1 - offset
    return { n, item: props.items[n % props.items.length]! }
  }),
)
</script>

<template>
  <ul class="flex flex-col">
    <li
      v-for="({ n, item }, position) in shown"
      :key="n"
      class="grid grid-rows-[1fr]"
      :class="[
        arrived && position === 0 && '[animation:row-in_520ms_var(--ease-out)]',
        position === visible && '[animation:row-out_520ms_var(--ease-out)_forwards]',
      ]"
      :aria-hidden="position === visible || undefined"
    >
      <div class="min-h-0 overflow-hidden">
        <slot :item="item" />
      </div>
    </li>
  </ul>
</template>
