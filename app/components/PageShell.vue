<script setup lang="ts">
const { wide = false } = defineProps<{
  id: string
  title: string
  description?: string
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
