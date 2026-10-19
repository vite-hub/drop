<script setup lang="ts">
// Claude Code's composer: ❯ between two rules, and the mode line under it.
// Ported from Brainless (MIT, see LICENSE); the input is display-only, filled by the default slot.
</script>

<template>
  <div class="min-w-0 font-mono text-[13px] leading-[1.6]">
    <div class="flex min-w-0 items-center border-y border-[#808080] py-0.5 text-[#c0caf5]">
      <span aria-hidden="true" class="shrink-0">❯</span>
      <span class="flex min-h-[1.6em] min-w-0 flex-1 items-center pl-[1ch]"
        ><slot /><span
          class="h-[1.15em] w-[1ch] animate-[blink_1s_steps(1)_infinite] bg-[#c0caf5]/80 motion-reduce:animate-none"
      /></span>
    </div>
    <div class="mt-1.5 truncate px-1 text-[12px]">
      <span class="text-[#ffd700]"><span aria-hidden="true">⏵⏵ </span>auto mode on</span>
      <span class="text-[#949494]"> (shift+tab to cycle)</span>
    </div>
  </div>
</template>
