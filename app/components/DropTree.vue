<script setup lang="ts">
// Every drop at the top, newest first. Folders open to the drops in them, apps to their pages (DropTreeItem).
// Hundreds of rows took every page's server render seconds, so the tree lists the newest ROWS, and the drop that's
// open wherever it sits, then a button for more.
const emit = defineEmits<{ navigate: [] }>()
const { data: drops, status } = useDrops()
const route = useRoute()
const ROWS = 30
const shown = ref(ROWS)
const listed = computed(() => {
  const here = drops.value.findIndex((drop) => route.path === `/drops/${drop.id}`)
  return drops.value.slice(0, Math.max(shown.value, here + 1))
})
</script>

<template>
  <div v-if="status === 'pending' && !drops.length" class="space-y-1.5 px-2.5 py-1">
    <USkeleton v-for="index in 3" :key="index" class="h-5 w-full" />
  </div>
  <ul v-else class="flex flex-col gap-px">
    <li v-if="!drops.length" class="px-2 py-1 text-sm text-dimmed">No drops yet</li>
    <DropTreeItem v-for="drop in listed" :key="drop.id" :drop="drop" @navigate="emit('navigate')" />
    <li v-if="drops.length > listed.length">
      <button
        class="flex h-7 w-full cursor-pointer items-center rounded-md px-2 text-sm text-dimmed transition-colors hover:bg-accented/60 hover:text-highlighted"
        type="button"
        @click="shown = listed.length + ROWS"
      >
        {{ drops.length - listed.length }} more
      </button>
    </li>
  </ul>
</template>
