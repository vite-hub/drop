<script setup lang="ts">
const { hidden, toggle } = useSidebarHidden()
const updateReady = useUpdateReady()
const { ui } = useAppConfig()
</script>

<template>
  <UTooltip v-if="hidden" :kbds="['meta', 'b']" :text="updateReady ? 'Show sidebar. Update ready' : 'Show sidebar'">
    <UButton
      :aria-label="updateReady ? 'Show sidebar, update ready' : 'Show sidebar'"
      class="relative hidden lg:flex"
      color="neutral"
      :icon="ui.icons.panelOpen"
      size="sm"
      variant="ghost"
      @click="toggle"
    >
      <template v-if="updateReady" #trailing>
        <span class="absolute top-1 right-1 size-1.5 rounded-full bg-info ring-2 ring-(--ui-bg)" />
      </template>
    </UButton>
  </UTooltip>
</template>
