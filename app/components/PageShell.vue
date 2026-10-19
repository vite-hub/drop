<script setup lang="ts">
// shadcn's SiteHeader over a page: an h-12 bar with the sidebar toggle (below lg, or once ⌘B folds the sidebar), the
// page title and its actions, then the page in a max-w-5xl column with p-4 lg:p-6, its description first.
const { wide = false } = defineProps<{ id: string; title: string; description?: string; wide?: boolean }>()
</script>

<template>
  <UDashboardPanel :id="id" :ui="{ body: 'p-0 sm:p-0 gap-0' }">
    <template #header>
      <UDashboardNavbar :ui="{ root: 'h-12 gap-2 px-4 lg:px-6', title: 'text-sm font-medium' }" :title="title">
        <template #leading>
          <SidebarExpand />
        </template>
        <template v-if="$slots.actions" #right>
          <slot name="actions" />
        </template>
      </UDashboardNavbar>
    </template>
    <template #body>
      <div class="mx-auto w-full p-4 lg:p-6" :class="wide ? 'max-w-6xl' : 'max-w-5xl'">
        <p v-if="description || $slots.description" class="mb-6 max-w-2xl text-sm text-muted">
          <slot name="description">{{ description }}</slot>
        </p>
        <slot />
      </div>
    </template>
  </UDashboardPanel>
</template>
