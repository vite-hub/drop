<script setup lang="ts">
// The docs nav as a tree under the sidebar's Docs item: each section folds, and the one holding the current page starts open.
const emit = defineEmits<{ navigate: [] }>()
const route = useRoute()
const active = (to: string) => isActivePath(route.path, to)
const open = ref<Record<string, boolean>>({})
const expanded = (group: (typeof DOCS_NAV)[number]) => open.value[group.title] ?? group.links.some(link => active(link.to))

const row = "flex min-w-0 items-center gap-2 rounded-md py-1 text-[13px] transition-colors"
const idle = "text-muted hover:bg-elevated hover:text-highlighted"
</script>

<template>
  <ul class="flex flex-col gap-px">
    <li v-for="group in DOCS_NAV" :key="group.title">
      <button
        :aria-expanded="expanded(group)"
        :class="[row, idle, 'w-full cursor-pointer pr-1 pl-2']"
        type="button"
        @click="open[group.title] = !expanded(group)"
      >
        <span class="flex-1 truncate text-left">{{ group.title }}</span>
        <UIcon name="i-lucide-chevron-right" class="size-3.5 shrink-0 text-dimmed transition-transform duration-150" :class="expanded(group) && 'rotate-90'" />
      </button>
      <ul v-if="expanded(group)" class="ml-4 flex flex-col gap-px border-l border-default py-0.5 pl-1">
        <li v-for="link in group.links" :key="link.to">
          <NuxtLink
            :aria-current="active(link.to) ? 'page' : undefined"
            :class="[row, 'px-2', active(link.to) ? 'bg-elevated text-highlighted' : idle]"
            :to="link.to"
            @click="emit('navigate')"
          >
            <UIcon v-if="link.icon" :name="link.icon" class="size-3.5 shrink-0 text-dimmed" />
            <span class="truncate">{{ link.label }}</span>
          </NuxtLink>
        </li>
      </ul>
    </li>
  </ul>
</template>
