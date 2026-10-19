<script setup lang="ts">
// One sidebar link in shadcn's SidebarMenuButton shape: h-8, 8px corners, a 16px icon that fills in when active.
// Both icon names are literals at the call site, so the icon bundle's scanner sees them. The slot is SidebarMenuAction:
// a control on the row's right edge, beside the link rather than inside it. Without `to` the row is a button, for rows
// that do something before (or instead of) navigating, like Docs sliding the sidebar over.
defineProps<{ to?: string; label: string; icon: string; activeIcon: string; active: boolean; trailingIcon?: string }>()
const emit = defineEmits<{ navigate: [] }>()
const NuxtLink = resolveComponent("NuxtLink")
</script>

<template>
  <div class="relative">
    <component
      :is="to ? NuxtLink : 'button'"
      :aria-current="active ? 'page' : undefined"
      class="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
      :class="[
        active ? 'bg-elevated font-medium text-highlighted' : 'text-muted hover:bg-elevated hover:text-highlighted',
        $slots.default && 'pr-8',
      ]"
      :to="to"
      :type="to ? undefined : 'button'"
      @click="emit('navigate')"
    >
      <UIcon :name="active ? activeIcon : icon" class="size-4 shrink-0" />
      <span class="truncate">{{ label }}</span>
      <UIcon v-if="trailingIcon" :name="trailingIcon" class="ml-auto size-3.5 shrink-0 text-dimmed" />
    </component>
    <div v-if="$slots.default" class="absolute inset-y-0 right-1 flex items-center"><slot /></div>
  </div>
</template>
