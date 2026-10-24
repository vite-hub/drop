<script setup lang="ts">
// Like T3 Code: once the sidebar is folded away, the button that brings it back leads the page's top bar. Wide
// screens only, as the sidebar is; below lg the top bar has the menu toggle instead. A plain button, not Nuxt UI's
// collapse toggle: on a link opened straight away the sidebar is out of sight while its own state says open.
// A newer deploy puts a dot on it, since the sidebar's Update ready row (UpdateReady) is out of sight.
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
