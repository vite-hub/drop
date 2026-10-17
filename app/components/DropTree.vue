<script setup lang="ts">
// Every drop at the top, newest first. Folders open to the drops in them, apps to their pages (DropTreeItem).
const emit = defineEmits<{ navigate: [] }>()
const { data: drops, status } = useDrops()
</script>

<template>
  <div v-if="status === 'pending' && !drops.length" class="space-y-1.5 px-2.5 py-1">
    <USkeleton v-for="index in 3" :key="index" class="h-5 w-full" />
  </div>
  <ul v-else class="flex flex-col gap-px">
    <li v-if="!drops.length" class="px-2 py-1 text-sm text-dimmed">No drops yet</li>
    <DropTreeItem v-for="drop in drops" :key="drop.id" :drop="drop" @navigate="emit('navigate')" />
  </ul>
</template>
