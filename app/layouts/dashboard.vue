<script setup lang="ts">
// shadcn's sidebar (sidebar-07) on Executor's flat console: one background, a hairline between sidebar and page, your
// search above the drops, Drops folding open into their tree like Google Drive's My Drive (apps are folders), the
// workspace pages and Docs at the bottom, and the account menu (NavUser) opening upward.
//
// Docs is a pane of its own: picking it slides everything under Search out to the left and the docs nav in from the
// right, with Back at its top; Back slides the other way and stays on the page. The logo, Search and the account menu
// hold still. Docs pages use another layout (docs.vue wraps this one), so the slide runs here first and the page opens
// once it's done; the sidebar there starts on the docs pane, and the swap doesn't show.
const route = useRoute()
const open = ref(false)
const at = (path: string) => route.path === path || route.path.startsWith(`${path}/`)
const close = () => (open.value = false)

const onDrops = computed(() => route.path === "/drops" && route.query.tab !== "with-me")
const onShared = computed(() => route.path === "/drops" && route.query.tab === "with-me")
// Drops start open on their tree; the caret folds it away.
const dropsOpen = ref(true)
const workspace = computed(() => [
  { label: "Agents", icon: "i-ph-sparkle", activeIcon: "i-ph-sparkle-fill", to: "/agents", active: at("/agents") || at("/approve") },
  { label: "Skills", icon: "i-ph-puzzle-piece", activeIcon: "i-ph-puzzle-piece-fill", to: "/skills", active: at("/skills") },
  { label: "Members", icon: "i-ph-users", activeIcon: "i-ph-users-fill", to: "/members", active: at("/members") },
])

const pane = ref<"main" | "docs">(at("/docs") ? "docs" : "main")
const slide = ref<"forward" | "back">("forward")
/** As long as `.sidebar-forward-*` / `.sidebar-back-*` in main.css run, so the page opens once the docs pane is in. */
const SLIDE_MS = 220
async function openDocs() {
  slide.value = "forward"
  pane.value = "docs"
  if (at("/docs")) return
  await new Promise(resolve => setTimeout(resolve, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : SLIDE_MS))
  // Back during the slide cancels the trip.
  if (pane.value === "docs") await navigateTo("/docs")
}
// The Docs row is a button, so it gets no link prefetch: load the page's code on hover, ready when the slide ends.
const preloadDocs = () => void preloadRouteComponents("/docs")
function leaveDocs() {
  slide.value = "back"
  pane.value = "main"
}
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

      <!-- Everything between Search and the account menu: the main pane or the docs pane, sliding past each other. -->
      <div class="relative -mx-2 flex min-h-0 flex-1 overflow-hidden">
        <Transition :name="`sidebar-${slide}`">
          <div v-if="pane === 'main'" key="main" class="flex min-h-0 w-full min-w-0 flex-col bg-default px-2">
            <!-- Drops, their tree, and Shared with me: the part of this pane that scrolls. -->
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
              <SidebarItem active-icon="i-ph-book-open-fill" :active="at('/docs')" icon="i-ph-book-open" label="Docs" trailing-icon="i-ph-caret-right" @focusin="preloadDocs" @navigate="openDocs" @pointerenter="preloadDocs" />
            </div>
          </div>

          <nav v-else key="docs" aria-label="Docs" class="relative z-10 flex min-h-0 w-full min-w-0 flex-col gap-0.5 overflow-y-auto bg-default px-2 pb-2">
            <SidebarItem active-icon="i-ph-arrow-left" :active="false" icon="i-ph-arrow-left" label="Back" @navigate="leaveDocs" />
            <p class="label-mono mt-2 flex h-8 shrink-0 items-center px-2">Docs</p>
            <DocsTree @navigate="close" />
          </nav>
        </Transition>
      </div>

      <template #footer>
        <UserMenu />
      </template>
    </UDashboardSidebar>

    <slot />

    <SearchPalette />
  </UDashboardGroup>
</template>
