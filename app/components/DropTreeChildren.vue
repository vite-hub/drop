<script setup lang="ts">
// The drops in an open folder of the sidebar tree, fetched when it opens.
const props = defineProps<{ id: string }>()
const emit = defineEmits<{ navigate: [] }>()
const { data: drops, status } = useFolder(() => props.id)
</script>

<template>
  <li v-if="status === 'pending' && !drops.length" class="px-2 py-1"><USkeleton class="h-4 w-full" /></li>
  <li v-else-if="!drops.length" class="px-2 py-1 text-sm text-dimmed">Empty</li>
  <DropTreeItem v-for="drop in drops" :key="drop.id" :drop="drop" @navigate="emit('navigate')" />
</template>
