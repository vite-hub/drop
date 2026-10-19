<script setup lang="ts">
// The drops in an open folder on the Drops page, as rows one step further in. `team`: the folder is the team's.
const props = defineProps<{ id: string; depth: number; team?: boolean }>()
const { data: drops, status } = useFolder(() => props.id)
const { remove, restore, deleteForever } = useDropActions()
const open = useRowsOpen()
</script>

<template>
  <li v-if="status === 'pending' && !drops.length" class="py-3 pr-4 pl-16"><USkeleton class="h-9 w-full" /></li>
  <template v-for="drop in drops" :key="drop.id">
    <DropRow
      :depth="depth"
      :drop="drop"
      :in-team="team"
      :open="open[drop.id]"
      @delete="remove(drop)"
      @delete-forever="deleteForever(drop)"
      @restore="restore(drop)"
      @toggle="open[drop.id] = !open[drop.id]"
    />
    <DropFolderRows
      v-if="drop.kind === 'folder' && open[drop.id]"
      :id="drop.id"
      :depth="depth + 1"
      :team="team || drop.teamFolder"
    />
  </template>
</template>
