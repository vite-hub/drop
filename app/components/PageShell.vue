<script setup lang="ts">
// Executor's PageContainer + PageHeader: a max-w-4xl column, a 2rem regular-weight title, actions on the right.
withDefaults(defineProps<{ id: string; title: string; description?: string; wide?: boolean }>(), { description: undefined, wide: false })
</script>

<template>
  <UDashboardPanel :id="id" :ui="{ body: 'p-0 sm:p-0 gap-0' }">
    <template #header>
      <UDashboardNavbar :title="title" class="lg:hidden" />
    </template>
    <template #body>
      <div class="mx-auto w-full px-6 py-10 lg:px-8 lg:py-14" :class="wide ? 'max-w-5xl' : 'max-w-4xl'">
        <div class="mb-10 flex flex-wrap items-start justify-between gap-4">
          <div class="min-w-0">
            <h1 class="text-[2rem] leading-none font-normal tracking-tight text-highlighted">{{ title }}</h1>
            <p v-if="description || $slots.description" class="mt-2 max-w-2xl text-sm text-muted">
              <slot name="description">{{ description }}</slot>
            </p>
          </div>
          <div v-if="$slots.actions" class="flex items-center gap-2"><slot name="actions" /></div>
        </div>
        <slot />
      </div>
    </template>
  </UDashboardPanel>
</template>
