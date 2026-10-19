<script setup lang="ts">
// Opened through useMoveDialog(): pick a folder to move a drop into, or the top. Resolves true once it moved.
// A folder never goes inside itself, so it and everything below it stay out of the list.
import type { DropSummary } from "#shared/types"

const props = defineProps<{ drop: Pick<DropSummary, "id" | "title" | "kind" | "parentId"> }>()
const emit = defineEmits<{ close: [moved: boolean] }>()
const { move } = useDropActions()
const { data: folders, status } = useApi<DropSummary[]>("/api/drops", {
  key: keys.folders,
  query: { folders: 1 },
  default: () => [],
  server: false,
})
const busy = ref(false)

const where = (folder: DropSummary) => [...(folder.path ?? []).map((crumb) => crumb.title), folder.title].join(" / ")
const groups = computed(() => [
  {
    id: "folders",
    items: [
      ...(props.drop.parentId
        ? [{ label: "Top level", description: "Out of every folder", icon: "i-ph-stack", onSelect: () => pick(null) }]
        : []),
      ...folders.value
        .filter(
          (folder) =>
            folder.id !== props.drop.id &&
            folder.id !== props.drop.parentId &&
            !folder.path?.some((crumb) => crumb.id === props.drop.id),
        )
        .map((folder) => ({
          label: folder.title,
          description: folder.path?.length ? where(folder) : undefined,
          icon: "i-ph-folder",
          onSelect: () => pick(folder),
        })),
    ],
  },
])

async function pick(folder: DropSummary | null) {
  if (busy.value) return
  busy.value = true
  const moved = await move(props.drop, folder)
  busy.value = false
  if (moved) emit("close", true)
}
</script>

<template>
  <UModal :description="drop.title" title="Move to folder" @update:open="(open) => !open && emit('close', false)">
    <template #content>
      <UCommandPalette
        close
        :groups="groups"
        :loading="status === 'pending' || busy"
        placeholder="Find a folder"
        :ui="{ empty: 'py-10 text-sm text-muted' }"
        @update:open="(open) => !open && emit('close', false)"
      >
        <template #empty>No other folders yet. Create one on the Drops page.</template>
      </UCommandPalette>
    </template>
  </UModal>
</template>
