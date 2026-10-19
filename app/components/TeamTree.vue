<script setup lang="ts">
// The team's folders, for the sidebar on a team Drop. Each opens to what's in it, like any folder (DropTreeItem).
const emit = defineEmits<{ navigate: [] }>()
const { data: shared, status } = useSharedWithMe()
const folders = computed(() => shared.value.filter(drop => drop.teamFolder))
</script>

<template>
  <div v-if="status === 'pending' && !folders.length" class="space-y-1.5 px-2.5 py-1">
    <USkeleton v-for="index in 2" :key="index" class="h-5 w-full" />
  </div>
  <ul v-else class="flex flex-col gap-px">
    <li v-if="!folders.length" class="px-2 py-1 text-sm text-dimmed">No team folders yet</li>
    <DropTreeItem v-for="drop in folders" :key="drop.id" :drop="drop" @navigate="emit('navigate')" />
  </ul>
</template>
