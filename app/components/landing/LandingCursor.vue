<script setup lang="ts">
// Someone's pointer on a stage: glides to (x, y) slowly enough to follow, with a name tag.
// `click` (ms into the current beat) plays a press and a ripple there; `beat` restarts it each beat.
defineProps<{ x: number; y: number; shown: boolean; label?: string; click?: number | null; beat?: string }>()
</script>

<template>
  <div
    class="pointer-events-none absolute top-0 left-0 z-50 transition-[transform,opacity] duration-900 ease-[cubic-bezier(0.45,0,0.2,1)]"
    :class="!shown && 'opacity-0'"
    :style="{ transform: `translate(${x}px, ${y}px)` }"
  >
    <template v-if="click != null">
      <span
        :key="`ring-${beat}`"
        class="absolute -top-3.5 -left-3.5 size-7 rounded-full border-2 border-(--ui-text-highlighted) opacity-0 [animation:click-ring_520ms_ease-out_both]"
        :style="{ animationDelay: `${click}ms` }"
      />
    </template>
    <div
      :key="`press-${beat}`"
      class="flex items-start"
      :class="click != null && '[animation:click-press_260ms_ease-out_both]'"
      :style="click != null ? { animationDelay: `${click}ms` } : undefined"
    >
      <svg
        viewBox="0 0 20 20"
        class="size-[22px] -translate-x-[3px] -translate-y-[2px] drop-shadow-[0_2px_3px_rgb(0_0_0/0.35)]"
        aria-hidden="true"
      >
        <path
          d="M3.5 2.5 17 9.2l-6.1 1.9-2.6 5.9z"
          class="fill-(--ui-text-highlighted) stroke-(--ui-bg)"
          stroke-width="1.6"
          stroke-linejoin="round"
        />
      </svg>
      <span
        v-if="label"
        class="mt-4 -ml-2 rounded-full bg-inverted px-2 py-0.5 text-[11px] font-medium text-inverted shadow-sm"
        >{{ label }}</span
      >
    </div>
  </div>
</template>
