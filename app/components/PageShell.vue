<script setup lang="ts">
// A page under one h-12 bar, like the doc viewer's: it continues the sidebar header's hairline and holds the title
// with its count in mono (Executor v2's), the description beside them, muted, and the page's actions. Below lg the
// description moves under the bar, where there's room for all of it. The page follows in a max-w-5xl column with
// p-4 lg:p-6.
const { wide = false } = defineProps<{
  id: string
  title: string
  description?: string
  /** How many things the page lists. Left out while they load. */
  count?: number
  wide?: boolean
}>()
</script>

<template>
  <UDashboardPanel :id="id" :ui="{ body: 'p-0 sm:p-0 gap-0' }">
    <template #header>
      <UDashboardNavbar
        :ui="{ root: 'h-12 gap-2 px-4 lg:px-6', left: 'min-w-0', title: 'shrink-0 text-sm font-medium' }"
      >
        <template #leading>
          <SidebarExpand />
        </template>
        <template #title>
          {{ title }}
          <span v-if="count !== undefined" class="font-mono text-xs font-normal text-muted tabular-nums">{{
            count
          }}</span>
        </template>
        <template v-if="description" #trailing>
          <p class="ml-2 hidden min-w-0 truncate text-sm text-muted lg:block" :title="description">{{ description }}</p>
        </template>
        <template v-if="$slots.actions" #right>
          <slot name="actions" />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <div class="mx-auto w-full p-4 lg:p-6" :class="wide ? 'max-w-6xl' : 'max-w-5xl'">
        <p v-if="description" class="mb-4 text-sm text-pretty text-muted lg:hidden">{{ description }}</p>
        <slot />
      </div>
    </template>
  </UDashboardPanel>
</template>
