<script setup lang="ts">
// "New" beside Upload on the Drops page and in a folder: one ghost button for the drops you make here rather than
// upload, a folder or a site to review. On a phone it keeps only its icon, so the bar doesn't push the title out.
import type { DropdownMenuItem } from "@nuxt/ui"

// `folder` false hides the folder entry: in a team folder only admins add folders.
const { folder = true } = defineProps<{ folder?: boolean }>()
const emit = defineEmits<{ folder: []; site: []; doc: []; board: [] }>()

const items = computed<DropdownMenuItem[]>(() => [
  ...(folder
    ? [
        {
          label: "Folder",
          description: "Groups related drops",
          icon: "i-mingcute-folder-line",
          onSelect: () => emit("folder"),
        },
      ]
    : []),
  {
    label: "Doc",
    description: "A Markdown doc to write together",
    icon: KIND_ICONS.markdown,
    onSelect: () => emit("doc"),
  },
  {
    label: "Board",
    description: "A whiteboard to draw on together",
    icon: "i-mingcute-drawing-board-line",
    onSelect: () => emit("board"),
  },
  {
    label: "Site review",
    description: "Comments on a live URL",
    icon: "i-mingcute-globe-line",
    onSelect: () => emit("site"),
  },
])
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'end' }" :ui="{ content: 'w-64' }">
    <UButton
      aria-label="New"
      color="neutral"
      icon="i-mingcute-add-line"
      size="sm"
      trailing-icon="i-mingcute-down-line"
      :ui="{ trailingIcon: 'max-sm:hidden size-3.5 text-dimmed' }"
      variant="ghost"
    >
      <span class="max-sm:hidden">New</span>
    </UButton>
  </UDropdownMenu>
</template>
