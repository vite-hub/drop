<script setup lang="ts">
// Executor's console shell: a 14rem sidebar the same color as the page, one hairline, Drops on top as a tree
// (apps are folders), the rest of the nav pinned to the bottom, and the account menu opening upward.
const route = useRoute()
const open = ref(false)
const at = (path: string) => route.path === path || route.path.startsWith(`${path}/`)
const close = () => (open.value = false)

const bottom = computed(() => [
  { label: "Agents", icon: "i-lucide-bot", to: "/agents", active: at("/agents") || at("/approve") },
  { label: "Members", icon: "i-lucide-users", to: "/members", active: at("/members") },
  { label: "Docs", icon: "i-lucide-book-open", to: "/docs", active: at("/docs") },
])
const item = "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors"
</script>

<template>
  <UDashboardGroup unit="rem" storage="cookie" storage-key="drop">
    <UDashboardSidebar
      id="nav"
      v-model:open="open"
      :default-size="14"
      :min-size="12"
      :max-size="20"
      resizable
      :ui="{ root: 'bg-default', header: 'h-12 border-b border-default px-4', body: 'gap-0 p-2', footer: 'border-t border-default p-2' }"
    >
      <template #header>
        <NuxtLink class="flex items-center gap-1.5" to="/drops" @click="close">
          <DropMark class="h-4 w-6" />
          <span class="font-mono text-sm font-medium tracking-tight">drop</span>
          <span class="rounded border border-default px-1 font-mono text-[10px] leading-4 text-muted">v0.1</span>
        </NuxtLink>
      </template>

      <NuxtLink :class="[item, route.path === '/drops' ? 'bg-elevated font-medium text-highlighted' : 'text-muted hover:bg-elevated hover:text-highlighted']" to="/drops" @click="close">
        <UIcon name="i-lucide-layers" class="size-4" />Drops
      </NuxtLink>
      <!-- Drops live under the Drops item: a guide line ties them to it, like folders in a file tree. -->
      <div class="-mx-2 mt-0.5 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <div class="ml-[1.0625rem] border-l border-default pl-1.5">
          <DropTree @navigate="close" />
        </div>
      </div>
      <div class="flex flex-col gap-px border-t border-default pt-2">
        <NuxtLink
          v-for="link in bottom"
          :key="link.to"
          :class="[item, link.active ? 'bg-elevated font-medium text-highlighted' : 'text-muted hover:bg-elevated hover:text-highlighted']"
          :to="link.to"
          @click="close"
        >
          <UIcon :name="link.icon" class="size-4" />{{ link.label }}
        </NuxtLink>
      </div>

      <template #footer>
        <UserMenu />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>
