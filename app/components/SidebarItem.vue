<script setup lang="ts">
// One sidebar link in shadcn's SidebarMenuButton shape: h-8, 8px corners, a 16px icon that fills in when active.
// Both icon names are literals at the call site, so the icon bundle's scanner sees them. The slot is SidebarMenuAction:
// a control on the row's right edge, beside the link rather than inside it.
defineProps<{ to: string; label: string; icon: string; activeIcon: string; active: boolean }>()
const emit = defineEmits<{ navigate: [] }>()
</script>

<template>
  <div class="relative">
    <NuxtLink
      :aria-current="active ? 'page' : undefined"
      class="flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
      :class="[active ? 'bg-elevated font-medium text-highlighted' : 'text-muted hover:bg-elevated hover:text-highlighted', $slots.default && 'pr-8']"
      :to="to"
      @click="emit('navigate')"
    >
      <UIcon :name="active ? activeIcon : icon" class="size-4 shrink-0" />
      <span class="truncate">{{ label }}</span>
    </NuxtLink>
    <div v-if="$slots.default" class="absolute inset-y-0 right-1 flex items-center"><slot /></div>
  </div>
</template>
