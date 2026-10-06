<script setup lang="ts">
// Every drop, newest first. Apps are folders you can open to jump to a file.
const emit = defineEmits<{ navigate: [] }>()
const { data: drops, status } = useDrops()
const route = useRoute()
const open = useTreeOpen()
const file = computed(() => (typeof route.query.file === "string" ? route.query.file : null))
const here = (id: string) => route.path === `/drops/${id}`

const row = "flex min-w-0 items-center gap-2 rounded-md py-1 text-[13px] transition-colors"
const idle = "text-muted hover:bg-elevated hover:text-highlighted"
const active = "bg-elevated text-highlighted"
</script>

<template>
  <div v-if="status === 'pending' && !drops.length" class="space-y-1.5 px-2.5 py-1">
    <USkeleton v-for="index in 3" :key="index" class="h-5 w-full" />
  </div>
  <ul v-else class="flex flex-col gap-px">
    <li v-if="!drops.length" class="px-2 py-1 text-[13px] text-dimmed">No drops yet</li>
    <li v-for="drop in drops" :key="drop.id">
      <NuxtLink v-if="drop.kind !== 'app'" :class="[row, 'px-2', here(drop.id) ? active : idle]" :to="`/drops/${drop.id}`" @click="emit('navigate')">
        <UIcon :name="KIND_ICONS[drop.kind]!" class="size-3.5 shrink-0 text-dimmed" />
        <span class="truncate" :title="drop.title">{{ drop.title }}</span>
      </NuxtLink>
      <template v-else>
        <div :class="[row, 'pl-2 pr-1', here(drop.id) && !file ? active : idle]">
          <NuxtLink class="flex min-w-0 flex-1 items-center gap-2" :to="`/drops/${drop.id}`" @click="emit('navigate')">
            <UIcon name="i-lucide-folder" class="size-3.5 shrink-0 text-dimmed" />
            <span class="truncate" :title="drop.title">{{ drop.title }}</span>
          </NuxtLink>
          <button
            :aria-expanded="open[drop.id] ?? here(drop.id)"
            :aria-label="`${(open[drop.id] ?? here(drop.id)) ? 'Collapse' : 'Expand'} ${drop.title}`"
            class="grid size-5 shrink-0 cursor-pointer place-items-center rounded text-dimmed hover:bg-accented hover:text-highlighted"
            type="button"
            @click="open[drop.id] = !(open[drop.id] ?? here(drop.id))"
          >
            <UIcon name="i-lucide-chevron-right" class="size-3.5 transition-transform duration-150" :class="(open[drop.id] ?? here(drop.id)) && 'rotate-90'" />
          </button>
        </div>
        <ul v-if="open[drop.id] ?? here(drop.id)" class="ml-4 flex flex-col gap-px border-l border-default py-0.5 pl-1">
          <li v-for="path in drop.paths" :key="path">
            <NuxtLink
              :class="[row, 'px-2 font-mono text-xs', here(drop.id) && file === path ? active : idle]"
              :to="{ path: `/drops/${drop.id}`, query: { file: path } }"
              @click="emit('navigate')"
            >
              <span class="truncate">{{ path }}</span>
            </NuxtLink>
          </li>
        </ul>
      </template>
    </li>
  </ul>
</template>
