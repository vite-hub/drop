<script setup lang="ts">
// One drop in the sidebar tree. A folder opens to the drops in it (fetched when opened, see DropTreeChildren) and an
// app to its pages; either is open on its own page unless toggled shut.
import type { DropSummary } from "#shared/types"

const props = defineProps<{ drop: DropSummary }>()
const emit = defineEmits<{ navigate: [] }>()
const route = useRoute()
const open = useTreeOpen()
const file = computed(() => (typeof route.query.file === "string" ? route.query.file : null))
const here = computed(() => route.path === `/drops/${props.drop.id}`)
const expandable = computed(() => props.drop.kind === "app" || (props.drop.kind === "folder" && Boolean(props.drop.items)))
const expanded = computed(() => open.value[props.drop.id] ?? here.value)

const row = "flex h-7 min-w-0 items-center gap-2 rounded-md text-sm transition-colors"
const idle = "text-muted hover:bg-elevated hover:text-highlighted"
const active = "bg-elevated text-highlighted"
</script>

<template>
  <li>
    <NuxtLink v-if="!expandable" :class="[row, 'px-2', here ? active : idle]" :to="`/drops/${drop.id}`" @click="emit('navigate')">
      <UIcon :name="KIND_ICONS[drop.kind] ?? 'i-ph-file'" class="size-4 shrink-0 text-dimmed" />
      <span class="truncate" :title="drop.title">{{ drop.title }}</span>
    </NuxtLink>
    <template v-else>
      <div :class="[row, 'pl-2 pr-1', here && !file ? active : idle]">
        <NuxtLink class="flex min-w-0 flex-1 items-center gap-2" :to="`/drops/${drop.id}`" @click="emit('navigate')">
          <UIcon :name="drop.kind === 'folder' && expanded ? 'i-ph-folder-open' : KIND_ICONS[drop.kind]!" class="size-4 shrink-0 text-dimmed" />
          <span class="truncate" :title="drop.title">{{ drop.title }}</span>
        </NuxtLink>
        <button
          :aria-expanded="expanded"
          :aria-label="`${expanded ? 'Collapse' : 'Expand'} ${drop.title}`"
          class="grid size-5 shrink-0 cursor-pointer place-items-center rounded-sm text-dimmed hover:bg-accented hover:text-highlighted"
          type="button"
          @click="open[drop.id] = !expanded"
        >
          <UIcon name="i-ph-caret-right" class="size-3.5 transition-transform duration-150" :class="expanded && 'rotate-90'" />
        </button>
      </div>
      <ul v-if="expanded" class="ml-3.5 flex flex-col gap-px border-l border-default py-0.5 pl-2">
        <DropTreeChildren v-if="drop.kind === 'folder'" :id="drop.id" @navigate="emit('navigate')" />
        <template v-else>
          <li v-for="path in appPages(drop.paths ?? [])" :key="path">
            <NuxtLink
              :class="[row, 'px-2 font-mono text-xs', here && file === path ? active : idle]"
              :to="{ path: `/drops/${drop.id}`, query: { file: path } }"
              @click="emit('navigate')"
            >
              <span class="truncate">{{ path }}</span>
            </NuxtLink>
          </li>
        </template>
      </ul>
    </template>
  </li>
</template>
