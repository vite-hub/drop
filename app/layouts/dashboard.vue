<script setup lang="ts">
// shadcn's sidebar (sidebar-07) on Executor's flat console: one background, a hairline between sidebar and page, your
// search above the drops, Drops folding open into their tree like Google Drive's My Drive (apps are folders), the
// workspace pages and Docs at the bottom, and the account menu (NavUser) opening upward.
const route = useRoute()
const open = ref(false)
const at = (path: string) => route.path === path || route.path.startsWith(`${path}/`)
const close = () => (open.value = false)

const onDrops = computed(() => route.path === "/drops" && route.query.tab !== "with-me")
const onShared = computed(() => route.path === "/drops" && route.query.tab === "with-me")
// Drops start open on their tree; the caret folds it away, like Docs below.
const dropsOpen = ref(true)
const workspace = computed(() => [
  { label: "Agents", icon: "i-ph-sparkle", activeIcon: "i-ph-sparkle-fill", to: "/agents", active: at("/agents") || at("/approve") },
  { label: "Skills", icon: "i-ph-puzzle-piece", activeIcon: "i-ph-puzzle-piece-fill", to: "/skills", active: at("/skills") },
  { label: "Members", icon: "i-ph-users", activeIcon: "i-ph-users-fill", to: "/members", active: at("/members") },
])
// Docs folds open into its sections, like an app in the drops tree: open on any docs page unless toggled shut.
const docsToggled = ref<boolean>()
const docsOpen = computed(() => docsToggled.value ?? at("/docs"))
</script>

<template>
  <UDashboardGroup unit="rem" storage="cookie" storage-key="drop">
    <UDashboardSidebar
      id="nav"
      v-model:open="open"
      :default-size="15"
      :min-size="12"
      :max-size="20"
      resizable
      :ui="{ root: 'bg-default', header: 'h-12 border-b border-default px-4', body: 'gap-0 p-2', footer: 'border-t border-default p-2' }"
    >
      <template #header>
        <NuxtLink class="flex items-center gap-2" to="/drops" @click="close">
          <DropMark class="h-4 w-6" />
          <span class="text-sm font-semibold tracking-tight">Drop</span>
          <span class="rounded-sm border border-default px-1 font-mono text-[11px] leading-4 text-muted">v0.1</span>
        </NuxtLink>
      </template>

      <!-- Opens the ⌘K palette (SearchPalette), which every dashboard page mounts below. -->
      <UDashboardSearchButton class="mb-2 w-full text-muted" label="Search" size="sm" />

      <!-- Drops, their tree, and Shared with me: the one part of the sidebar that scrolls. -->
      <nav aria-label="Main" class="-mx-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        <SidebarItem active-icon="i-ph-stack-fill" :active="onDrops" icon="i-ph-stack" label="Drops" to="/drops" @navigate="close">
          <button
            :aria-expanded="dropsOpen"
            :aria-label="dropsOpen ? 'Collapse drops' : 'Expand drops'"
            class="grid size-6 cursor-pointer place-items-center rounded-sm text-dimmed hover:bg-accented hover:text-highlighted"
            type="button"
            @click="dropsOpen = !dropsOpen"
          >
            <UIcon name="i-ph-caret-right" class="size-3.5 transition-transform duration-150" :class="dropsOpen && 'rotate-90'" />
          </button>
        </SidebarItem>
        <div v-if="dropsOpen" class="ml-3.5 border-l border-default pl-2">
          <DropTree @navigate="close" />
        </div>
        <SidebarItem active-icon="i-ph-tray-fill" :active="onShared" icon="i-ph-tray" label="Shared with me" to="/drops?tab=with-me" @navigate="close" />
      </nav>

      <div class="flex flex-col gap-0.5 border-t border-default pt-2">
        <SidebarItem v-for="link in workspace" :key="link.to" v-bind="link" @navigate="close" />
        <SidebarItem active-icon="i-ph-book-open-fill" :active="at('/docs')" icon="i-ph-book-open" label="Docs" to="/docs" @navigate="close">
          <button
            :aria-expanded="docsOpen"
            :aria-label="docsOpen ? 'Collapse docs' : 'Expand docs'"
            class="grid size-6 cursor-pointer place-items-center rounded-sm text-dimmed hover:bg-accented hover:text-highlighted"
            type="button"
            @click="docsToggled = !docsOpen"
          >
            <UIcon name="i-ph-caret-right" class="size-3.5 transition-transform duration-150" :class="docsOpen && 'rotate-90'" />
          </button>
        </SidebarItem>
        <div v-if="docsOpen" class="ml-3.5 border-l border-default pl-2">
          <DocsTree @navigate="close" />
        </div>
      </div>

      <template #footer>
        <UserMenu />
      </template>
    </UDashboardSidebar>

    <slot />

    <SearchPalette />
  </UDashboardGroup>
</template>
