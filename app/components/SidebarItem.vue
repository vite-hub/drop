<script setup lang="ts">
// One sidebar link in shadcn's SidebarMenuButton shape: h-8, 8px corners, a 16px icon that fills in when active.
// Active is bg-accented, hover 60% of it: the sidebar is bg-muted, where bg-elevated barely shows.
// Both icon names are literals at the call site, so the icon bundle's scanner sees them. The slot is SidebarMenuAction:
// a control on the row's right edge, beside the link rather than inside it. Without `to` the row is a button, for rows
// that do something before (or instead of) navigating, like Docs sliding the sidebar over.
// `count` ends the row in mono, like Executor v2's nav; `alert` marks one that waits on you, with `countLabel` saying
// what it counts to screen readers.
defineProps<{
  to?: string
  label: string
  icon: string
  activeIcon: string
  active: boolean
  trailingIcon?: string
  count?: number
  countLabel?: string
  alert?: boolean
}>()
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
        active ? 'bg-accented font-medium text-highlighted' : 'text-muted hover:bg-accented/60 hover:text-highlighted',
        $slots.default && 'pr-8',
      ]"
      :to="to"
      :type="to ? undefined : 'button'"
      @click="emit('navigate')"
    >
      <UIcon :name="active ? activeIcon : icon" class="size-4 shrink-0" />
      <span class="truncate">{{ label }}</span>
      <span
        v-if="count"
        class="ml-auto shrink-0 font-mono text-xs font-normal tabular-nums"
        :class="alert ? 'rounded-sm bg-inverted px-1 text-inverted' : 'text-dimmed'"
        ><span :aria-hidden="countLabel ? true : undefined">{{ count }}</span
        ><span v-if="countLabel" class="sr-only">, {{ countLabel }}</span></span
      >
      <UIcon v-if="trailingIcon" :name="trailingIcon" class="ml-auto size-3.5 shrink-0 text-dimmed" />
    </component>
    <div v-if="$slots.default" class="absolute inset-y-0 right-1 flex items-center"><slot /></div>
  </div>
</template>
