<script setup lang="ts">
import * as v from "valibot"
import { appLocation, appPageFor, pageUrl } from "#shared/project-bundle"
import type { DropSummary } from "#shared/types"

const props = defineProps<{ drop: DropSummary }>()
const emit = defineEmits<{ navigate: [] }>()
const route = useRoute()
const open = useTreeOpen()
const pages = computed(() => appPages(props.drop.paths ?? []))
const file = computed(() => {
  const at = appLocation(textValue(route.query.path))
  return at ? appPageFor(pages.value, at) : (textValue(route.query.file) ?? "index.html")
})
const here = computed(() => route.path === `/drops/${props.drop.id}`)
const expandable = computed(
  () => props.drop.kind === "app" || (props.drop.kind === "folder" && Boolean(props.drop.items)),
)
const expanded = computed(() => open.value[props.drop.id] ?? here.value)

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
const idle = "text-muted hover:bg-accented/60 hover:text-highlighted"
const active = "bg-accented text-highlighted"
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
      <DeferredMenu v-if="changeable" :content="{ align: 'start', side: 'right' }" :items="menu">
        <button
          :aria-label="`Actions for ${drop.title}`"
          class="size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-dimmed hover:bg-accented hover:text-highlighted"
          :class="reveal"
          type="button"
        >
          <UIcon name="i-mingcute-more-1-fill" class="size-3.5" />
        </button>
      </DeferredMenu>
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
          class="size-3.5 motion-safe:transition-transform duration-150"
          :class="expanded && 'rotate-90'"
        />
      </button>
    </div>
    <ul v-if="expandable && expanded" class="ml-3.5 flex flex-col gap-px border-l border-default py-0.5 pl-2">
      <DropTreeChildren v-if="drop.kind === 'folder'" :id="drop.id" @navigate="emit('navigate')" />
      <template v-else>
        <li v-for="path in pages" :key="path">
          <NuxtLink
            :class="[
              'flex h-7 min-w-0 items-center gap-2 rounded-md px-2 font-mono text-xs transition-colors',
              here && file === path ? active : idle,
            ]"
            :to="{ path: `/drops/${drop.id}`, query: path === 'index.html' ? {} : { path: pageUrl(path) } }"
            @click="emit('navigate')"
          >
            <span class="truncate">{{ path }}</span>
          </NuxtLink>
        </li>
      </template>
    </ul>
  </li>
</template>
