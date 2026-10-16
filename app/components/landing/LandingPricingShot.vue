<script setup lang="ts">
// A phone-width pricing card, as a before/after screenshot: before, the price runs off the card
// (circled by hand, the way pull-request evidence marks it); fixed, it wraps inside.
defineProps<{ fixed?: boolean }>()
</script>

<template>
  <div class="grid place-items-center overflow-hidden" :class="fixed ? 'bg-default' : 'bg-muted'">
    <div class="relative w-44 rounded-lg border border-default bg-default p-3 shadow-sm">
      <p class="label-mono text-[10px]">Team</p>
      <p class="mt-1 text-lg leading-tight font-semibold tracking-tight text-highlighted" :class="fixed ? 'text-balance' : 'whitespace-nowrap'">$1,200 per seat / month</p>
      <p class="mt-1 text-[10px] text-muted">Billed yearly</p>
      <span class="mt-2 block rounded-md bg-inverted py-1 text-center text-[10px] font-medium text-inverted">Choose Team</span>
      <svg v-if="!fixed" class="pointer-events-none absolute -top-1 left-24 h-14 w-36 overflow-visible" viewBox="0 0 140 56" fill="none" aria-hidden="true">
        <path d="M70 6C112 2 138 14 136 28 134 44 96 54 58 51 22 48 2 38 4 25 6 12 38 4 78 5" class="stroke-(--ui-error)" stroke-width="2" stroke-linecap="round" />
      </svg>
    </div>
  </div>
</template>
