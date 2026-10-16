<script setup lang="ts">
// One of the editor's "/", "@", or ":" menus on a stage: the hairline card app.config.ts gives Nuxt UI's menus.
// The caller places it under its trigger character.
defineProps<{ label: string }>()
</script>

<template>
  <div class="absolute z-10 w-56 rounded-lg border border-default bg-default p-1 text-[13px] text-toned shadow-[0_4px_16px_rgb(0_0_0/0.08)] [animation:pop-in_160ms_var(--ease-out)]">
    <p class="label-mono px-2 pt-1 pb-1.5 text-[10px]">{{ label }}</p>
    <slot />
  </div>
</template>
