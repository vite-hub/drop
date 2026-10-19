<script setup lang="ts">
// A conversation turn: the user's full-width prompt row, or plain assistant text after a ⏺.
// Ported from Brainless (MIT, see LICENSE).
const { role = "assistant" } = defineProps<{ role?: "user" | "assistant" }>()
</script>

<template>
  <div
    v-if="role === 'user'"
    class="flex w-full min-w-0 items-baseline bg-[#3a3a3a] font-mono text-[13px] leading-[1.55]"
  >
    <span aria-hidden="true" class="shrink-0 text-[#4e4e4e]">❯</span>
    <span aria-hidden="true" class="inline-block w-[1ch] shrink-0" />
    <span class="min-w-0 flex-1 break-words text-white"><slot /></span>
  </div>
  <div v-else class="flex min-w-0 items-baseline gap-2 font-mono text-[13px] leading-[1.6] text-[#c0caf5]">
    <span aria-hidden="true" class="shrink-0 text-white">⏺</span>
    <span class="min-w-0 break-words"><slot /></span>
  </div>
</template>
