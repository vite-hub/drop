<script setup lang="ts">
// The sidebar row a newer deploy brings in, above the account menu so both panes show it: a SidebarItem-shaped button
// whose icon carries a dot, and a click reloads onto the new build. The open page keeps the old one until then.
const ready = useUpdateReady()
</script>

<template>
  <UTooltip v-if="ready" text="A new version of Drop is out. Reload to use it.">
    <button
      aria-label="Update ready, reload"
      class="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-highlighted transition-colors outline-none hover:bg-accented/60 focus-visible:ring-2 focus-visible:ring-(--ring)"
      type="button"
      @click="reloadNuxtApp()"
    >
      <span class="relative shrink-0">
        <UIcon name="i-mingcute-refresh-2-line" class="block size-4" />
        <span class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-info ring-2 ring-(--ui-bg-muted)" />
      </span>
      <span class="truncate">Update ready</span>
      <span class="ml-auto shrink-0 text-xs font-normal text-dimmed">Reload</span>
    </button>
  </UTooltip>
  <span class="sr-only" role="status">{{ ready ? "A new version of Drop is out. Reload to use it." : "" }}</span>
</template>
