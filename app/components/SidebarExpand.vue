<script setup lang="ts">
// Like T3 Code: once the sidebar is folded away, the button that brings it back leads the page's top bar. Wide
// screens only, as the sidebar is; below lg the top bar has the menu toggle instead.
const collapsed = useSidebarCollapsed()
</script>

<template>
  <UTooltip v-if="collapsed" :kbds="['meta', 'b']" text="Show sidebar">
    <UDashboardSidebarCollapse size="sm" />
  </UTooltip>
</template>
