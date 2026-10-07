<script setup lang="ts">
// An endless, slow strip of logos that pauses on hover. Static and wrapped under reduced motion.
withDefaults(defineProps<{ seconds?: number }>(), { seconds: 40 })
</script>

<template>
  <div class="group relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)] motion-reduce:[mask-image:none]">
    <div
      class="flex w-max group-hover:[animation-play-state:paused] motion-safe:[animation:marquee_var(--loop)_linear_infinite] motion-reduce:w-auto motion-reduce:flex-wrap"
      :style="{ '--loop': `${seconds}s` }"
    >
      <div class="flex shrink-0 items-center gap-8 pr-8 motion-reduce:flex-wrap motion-reduce:gap-y-3"><slot /></div>
      <div aria-hidden="true" class="flex shrink-0 items-center gap-8 pr-8 motion-reduce:hidden"><slot /></div>
    </div>
  </div>
</template>
