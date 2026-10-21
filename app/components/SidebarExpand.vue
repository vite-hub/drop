<script setup lang="ts">
// Like T3 Code: once the sidebar is folded away, the button that brings it back leads the page's top bar. Wide
// screens only, as the sidebar is; below lg the top bar has the menu toggle instead. A plain button, not Nuxt UI's
// collapse toggle: on a link opened straight away the sidebar is out of sight while its own state says open.
const { hidden, toggle } = useSidebarHidden()
const { ui } = useAppConfig()
</script>

<template>
  <UTooltip v-if="hidden" :kbds="['meta', 'b']" text="Show sidebar">
    <UButton
      aria-label="Show sidebar"
      class="hidden lg:flex"
      color="neutral"
      :icon="ui.icons.panelOpen"
      size="sm"
      variant="ghost"
      @click="toggle"
    />
  </UTooltip>
</template>
