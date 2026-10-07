<script setup lang="ts">
defineProps<{ icon: string; label: string; destructive?: boolean }>()
defineEmits<{ click: [] }>()
</script>

<template>
  <button
    class="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-elevated"
    :class="destructive ? 'text-error' : 'text-highlighted'"
    type="button"
    @click="$emit('click')"
  >
    <UIcon :name="icon" class="size-4" :class="destructive ? '' : 'text-muted'" />
    <span class="flex-1">{{ label }}</span>
  </button>
</template>
