<script setup lang="ts">
// A card whose surface lights up under the pointer. No spotlight under reduced motion.
const card = useTemplateRef<HTMLElement>("card")
const motion = usePreferredReducedMotion()
const tracks = computed(() => motion.value !== "reduce")

function move(event: PointerEvent) {
  if (!tracks.value || !card.value) return
  const rect = card.value.getBoundingClientRect()
  card.value.style.setProperty("--spot-x", `${event.clientX - rect.left}px`)
  card.value.style.setProperty("--spot-y", `${event.clientY - rect.top}px`)
}
</script>

<template>
  <div
    ref="card"
    class="relative overflow-hidden bg-default [--spot-x:-999px] [--spot-y:-999px] before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(260px_circle_at_var(--spot-x)_var(--spot-y),color-mix(in_srgb,var(--ui-text-highlighted)_6%,transparent),transparent_70%)] before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100 motion-reduce:before:hidden"
    @pointermove="move"
  >
    <div class="relative">
      <slot />
    </div>
  </div>
</template>
