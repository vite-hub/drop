<script setup lang="ts">
// A phone-width pricing card, as a before/after screenshot: before, the price runs off the card
// (the overflow circled by hand, the way pull-request evidence marks it); fixed, it wraps inside.
defineProps<{ fixed?: boolean }>()
</script>

<template>
  <div class="grid place-items-center overflow-hidden" :class="fixed ? 'bg-default' : 'bg-muted'">
    <div class="relative w-40 rounded-lg border border-default bg-default p-3 shadow-sm">
      <p class="label-mono text-[10px]">Team</p>
      <p
        class="mt-1 text-lg leading-tight font-semibold tracking-tight text-highlighted"
        :class="fixed ? 'text-balance' : 'whitespace-nowrap'"
      >
        <span class="relative"
          >$1,200 per seat / month<svg
            v-if="!fixed"
            class="pointer-events-none absolute top-1/2 -right-3 h-11 w-28 -translate-y-1/2 overflow-visible"
            viewBox="0 0 112 44"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M60 4C94 2 110 12 108 22 106 34 80 42 50 40 20 38 3 31 4 21 5 11 28 4 64 5"
              class="stroke-(--ui-error)"
              stroke-width="2"
              stroke-linecap="round"
            /></svg
        ></span>
      </p>
      <p class="mt-1 text-[10px] text-muted">Billed yearly</p>
      <span class="mt-2 block rounded-md bg-inverted py-1 text-center text-[10px] font-medium text-inverted"
        >Choose Team</span
      >
    </div>
  </div>
</template>
