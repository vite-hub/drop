<script setup lang="ts">
// One message in the stage's team chat.
defineProps<{ name: string; time: string }>()
</script>

<template>
  <div class="flex gap-2.5">
    <span class="grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-semibold" :class="name === 'You' ? 'bg-inverted text-inverted' : 'bg-elevated text-highlighted'">{{ name[0] }}</span>
    <div class="min-w-0">
      <p><span class="font-semibold text-highlighted">{{ name }}</span> <span class="text-[10px] text-dimmed">{{ time }}</span></p>
      <div class="text-toned"><slot /></div>
    </div>
  </div>
</template>
