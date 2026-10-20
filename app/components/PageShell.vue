<script setup lang="ts">
// A page in Executor v2's shape: the title is the page's own heading, with its count beside it in mono, the
// description under it and the actions on its right, in a max-w-5xl column with p-4 lg:p-6. The h-12 top bar stays
// only where it holds a control: the menu toggle below lg, and the button that brings back a folded sidebar.
const { wide = false } = defineProps<{
  id: string
  title: string
  description?: string
  /** How many things the page lists. Left out while they load. */
  count?: number
  wide?: boolean
}>()
const collapsed = useSidebarCollapsed()
</script>

<template>
  <UDashboardPanel :id="id" :ui="{ body: 'p-0 sm:p-0 gap-0' }">
    <template #header>
      <UDashboardNavbar :class="!collapsed && 'lg:hidden'" :ui="{ root: 'h-12 gap-2 px-4 lg:px-6' }">
        <!-- #left, not #leading: the bar's own empty title would be a second h1. The menu toggle sits outside it. -->
        <template #left>
          <SidebarExpand />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <div class="mx-auto w-full p-4 lg:p-6" :class="wide ? 'max-w-6xl' : 'max-w-5xl'">
        <header class="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0 flex-1 basis-60">
            <h1 class="text-xl font-semibold tracking-tight text-balance text-highlighted">
              {{ title }}
              <span
                v-if="count !== undefined"
                class="ml-1 align-middle font-mono text-sm font-normal text-muted tabular-nums"
                >{{ count }}</span
              >
            </h1>
            <p v-if="description || $slots.description" class="mt-1 max-w-2xl text-sm text-pretty text-muted">
              <slot name="description">{{ description }}</slot>
            </p>
          </div>
          <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
            <slot name="actions" />
          </div>
        </header>
        <slot />
      </div>
    </template>
  </UDashboardPanel>
</template>
