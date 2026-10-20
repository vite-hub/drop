<script setup lang="ts">
// One drop in the sidebar tree. A folder opens to the drops in it (fetched when opened, see DropTreeChildren) and an
// app to its pages; either is open on its own page unless toggled shut. Hovering a drop you may change shows its menu:
// rename it, or move it to the Trash.
import * as v from "valibot"
import type { DropSummary } from "#shared/types"

const props = defineProps<{ drop: DropSummary }>()
const emit = defineEmits<{ navigate: [] }>()
const route = useRoute()
const open = useTreeOpen()
const file = computed(() => textValue(route.query.file) ?? null)
const here = computed(() => route.path === `/drops/${props.drop.id}`)
const expandable = computed(
  () => props.drop.kind === "app" || (props.drop.kind === "folder" && Boolean(props.drop.items)),
)
const expanded = computed(() => open.value[props.drop.id] ?? here.value)

// Yours, or a team folder when you're an admin, as on the Drops page's rows (DropRow).
const { data: me } = useMe()
const changeable = computed(() => !props.drop.owner && (!props.drop.teamFolder || me.value?.role === "admin"))
const { rename, remove } = useDropActions()
const prompt = usePrompt()
async function askRename() {
  const title = await prompt({
    title: "Rename",
    label: "Name",
    initial: props.drop.title,
    confirmLabel: "Rename",
    schema: v.pipe(v.string(), v.trim(), v.minLength(1, "Name it."), v.maxLength(160, "Keep it under 160 characters.")),
  })
  if (title && title !== props.drop.title) await rename(props.drop, title)
}
const menu = [
  [
    { label: "Rename", icon: "i-mingcute-pencil-line", onSelect: askRename },
    { label: "Move to Trash", icon: "i-mingcute-delete-2-line", onSelect: () => void remove(props.drop) },
  ],
]

const row = "group flex h-7 min-w-0 items-center gap-2 rounded-md pl-2 pr-1 text-sm transition-colors"
const idle = "text-muted hover:bg-elevated hover:text-highlighted"
const active = "bg-elevated text-highlighted"
// Hidden until the row is hovered or focused, so titles keep the width; touch screens always show it.
const reveal = "hidden group-hover:grid group-focus-within:grid data-[state=open]:grid pointer-coarse:grid"
</script>

<template>
  <li>
    <div :class="[row, here && !(expandable && file) ? active : idle]">
      <NuxtLink
        class="flex h-full min-w-0 flex-1 items-center gap-2"
        :to="`/drops/${drop.id}`"
        @click="emit('navigate')"
      >
        <UIcon
          :name="drop.kind === 'folder' && expanded ? 'i-mingcute-folder-open-line' : KIND_ICONS[drop.kind]"
          class="size-4 shrink-0 text-dimmed"
        />
        <span class="truncate" :title="drop.title">{{ drop.title }}</span>
      </NuxtLink>
      <UDropdownMenu v-if="changeable" :content="{ align: 'start', side: 'right' }" :items="menu">
        <button
          :aria-label="`Actions for ${drop.title}`"
          class="size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-dimmed hover:bg-accented hover:text-highlighted"
          :class="reveal"
          type="button"
        >
          <UIcon name="i-mingcute-more-1-line" class="size-3.5" />
        </button>
      </UDropdownMenu>
      <button
        v-if="expandable"
        :aria-expanded="expanded"
        :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${drop.title}`"
        class="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-dimmed hover:bg-accented hover:text-highlighted"
        type="button"
        @click="open[drop.id] = !expanded"
      >
        <UIcon
          name="i-mingcute-right-line"
          class="size-3.5 transition-transform duration-150"
          :class="expanded && 'rotate-90'"
        />
      </button>
    </div>
    <ul v-if="expandable && expanded" class="ml-3.5 flex flex-col gap-px border-l border-default py-0.5 pl-2">
      <DropTreeChildren v-if="drop.kind === 'folder'" :id="drop.id" @navigate="emit('navigate')" />
      <template v-else>
        <li v-for="path in appPages(drop.paths ?? [])" :key="path">
          <NuxtLink
            :class="[
              'flex h-7 min-w-0 items-center gap-2 rounded-md px-2 font-mono text-xs transition-colors',
              here && file === path ? active : idle,
            ]"
            :to="{ path: `/drops/${drop.id}`, query: { file: path } }"
            @click="emit('navigate')"
          >
            <span class="truncate">{{ path }}</span>
          </NuxtLink>
        </li>
      </template>
    </ul>
  </li>
</template>
