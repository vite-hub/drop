<script setup lang="ts">
// Claude Code's working line: a cycling sparkle, a shimmering verb, and the elapsed time.
// Ported from Brainless (MIT, see LICENSE). Holds still under reduced motion.
const props = withDefaults(defineProps<{ verb?: string }>(), { verb: "Percolating" })
const GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"]
const glyph = ref(2)
const seconds = ref(0)
const motion = usePreferredReducedMotion()
useIntervalFn(() => motion.value !== "reduce" && (glyph.value = (glyph.value + 1) % GLYPHS.length), 110)
useIntervalFn(() => seconds.value++, 1000)
</script>

<template>
  <div class="flex items-center gap-2 font-mono text-[13px]">
    <span aria-hidden="true" class="inline-block w-[1ch] text-[#cd694a]">{{ GLYPHS[glyph] }}</span>
    <span class="claude-verb">{{ props.verb }}…</span>
    <span class="text-[#7d7d7d]">({{ seconds }}s · ↑ {{ seconds * 137 }} tokens · esc to interrupt)</span>
  </div>
</template>

<style scoped>
.claude-verb {
  background-image: linear-gradient(100deg, #cd694a 43%, #e79475 50%, #cd694a 57%);
  background-size: 200% 100%;
  background-clip: text;
  color: transparent;
  animation: claude-shine 2.8s linear infinite;
}
@keyframes claude-shine {
  from { background-position: 100% 0 }
  to { background-position: -100% 0 }
}
@media (prefers-reduced-motion: reduce) {
  .claude-verb { animation: none; background-image: none; color: #cd694a }
}
</style>
