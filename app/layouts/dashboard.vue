<script setup lang="ts">
// shadcn's sidebar (sidebar-07) on Executor's flat console: one step lighter or darker than the page (bg-muted, at
// shadcn's --sidebar lightness), a hairline between sidebar and page, your search above the drops, Drops folding open
// into their tree like Google Drive's My Drive (apps are folders), the workspace pages and Docs at the bottom, and the
// account menu (NavUser) opening upward.
//
// Docs is a pane of its own: picking it slides everything under Search out to the left and the docs nav in from the
// right, with Back at its top; Back slides the other way and stays on the page. The logo, Search and the account menu
// hold still. Docs pages use another layout (docs.vue wraps this one), so the slide runs here first and the page opens
// once it's done; the sidebar there starts on the docs pane, and the swap doesn't show.
//
// ⌘B or the button in its header folds the whole sidebar away, like T3 Code; the pages' top bars then lead with the
// button that brings it back (SidebarExpand). The sidebar's cookie keeps it folded across visits. A drop's link opened
// straight away reads without it, until the next page (useOpenedOnLink).
// ? opens the keyboard shortcuts (ShortcutsModal).
import { promiseTimeout } from "@vueuse/core"

const route = useRoute()
const open = ref(false)
const at = (path: string) => route.path === path || route.path.startsWith(`${path}/`)
const close = () => (open.value = false)
const collapsed = useSidebarCollapsed()
const { hidden, toggle } = useSidebarHidden()
const onLink = useOpenedOnLink()
watch(
  () => route.name,
  (name) => name !== "d-id-slug" && (onLink.value = false),
)
defineShortcuts({ meta_b: toggle })
// The page in view tells the ⌘K palette (SearchPalette) which drop or folder is open.
providePaletteContext()

const onDrops = computed(() => route.path === "/drops" && route.query.tab !== "with-me")
const onShared = computed(() => route.path === "/drops" && route.query.tab === "with-me")
// Drops start open on their tree; the caret folds it away. A team Drop leads with the team's folders, and its Team page
// takes the place of Shared with me.
const dropsOpen = ref(true)
const teamOpen = ref(true)
const { data: me } = useMe()
const team = computed(() => me.value?.mode === "team")
// A personal Drop with teams lists each team you're on, its folders below it.
const teams = computed(() => me.value?.teams ?? null)
// Rows end in a count like Executor v2's nav: muted totals for what you have, and a marked one for what waits on you.
// Both are the keyed caches the trees and the Drops page read; only a personal Drop's Shared with me, which no tree
// shows, costs a fetch of its own.
const { total: dropCount } = useSidebarDrops()
const { data: shared } = useSharedWithMe()
// A personal Drop's teams list their folders under Teams, not under Shared with me.
const withMe = computed(() => (team.value ? shared.value : shared.value.filter((drop) => !drop.team)))
// Members see Skills only while one is on, since only admins can switch them on.
const admin = computed(() => me.value?.role === "admin")
const workspace = computed(() => [
  {
    label: "Agents",
    icon: "i-mingcute-sparkles-line",
    activeIcon: "i-mingcute-sparkles-fill",
    to: "/agents",
    active: at("/agents") || at("/approve"),
  },
  ...(admin.value || me.value?.skills
    ? [
        {
          label: "Skills",
          icon: "i-mingcute-plugin-2-line",
          activeIcon: "i-mingcute-plugin-2-fill",
          to: "/skills",
          active: at("/skills"),
        },
      ]
    : []),
  ...(admin.value
    ? [
        {
          label: "Console",
          icon: "i-mingcute-settings-3-line",
          activeIcon: "i-mingcute-settings-3-fill",
          to: "/_vitehub/auth",
          external: true,
          active: false,
        },
      ]
    : []),
])

// The policies live outside /docs but sit in its nav.
const inDocs = computed(() => at("/docs") || DOCS_PAGES.some((page) => isActivePath(route.path, page.to)))
const pane = ref<"main" | "docs">(inDocs.value ? "docs" : "main")
const slide = ref<"forward" | "back">("forward")
/** As long as `.sidebar-forward-*` / `.sidebar-back-*` in main.css run, so the page opens once the docs pane is in. */
const SLIDE_MS = 220
const motion = usePreferredReducedMotion()
async function openDocs() {
  slide.value = "forward"
  pane.value = "docs"
  if (inDocs.value) return
  await promiseTimeout(motion.value === "reduce" ? 0 : SLIDE_MS)
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
      v-model:collapsed="collapsed"
      collapsible
      :default-size="15"
      :min-size="12"
      :max-size="20"
      resizable
      :ui="{
        root: ['bg-muted', hidden && 'lg:hidden'],
        content: 'bg-muted',
        handle: hidden ? 'lg:hidden' : undefined,
        header: 'h-12 border-b border-default px-4',
        body: 'gap-0 p-2',
        footer: 'flex-col items-stretch gap-0.5 border-t border-default p-2',
      }"
    >
      <template #header>
        <NuxtLink class="flex items-center gap-2" to="/drops" @click="close">
          <DropMark class="h-4 w-6" />
          <span class="text-sm font-semibold tracking-tight">Drop</span>
          <span class="label-mono rounded-sm border border-default px-1 leading-4 tracking-normal normal-case"
            >v0.1</span
          >
        </NuxtLink>
        <UTooltip :kbds="['meta', 'b']" text="Hide sidebar">
          <UDashboardSidebarCollapse class="-mr-2 ml-auto" size="sm" />
        </UTooltip>
      </template>

      <!-- Opens the ⌘K palette (SearchPalette), which every dashboard page mounts below. -->
      <UDashboardSearchButton class="mb-2 w-full text-muted" label="Search" size="sm" />

      <!-- Everything between Search and the account menu: the main pane or the docs pane, sliding past each other. -->
      <div class="relative -mx-2 flex min-h-0 flex-1 overflow-hidden">
        <Transition :name="`sidebar-${slide}`">
          <div v-if="pane === 'main'" key="main" class="flex min-h-0 w-full min-w-0 flex-col bg-muted px-2">
            <!-- The team's folders, your drops, and what's shared with you: the part of this pane that scrolls. -->
            <nav aria-label="Main" class="-mx-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
              <template v-if="team">
                <SidebarItem
                  active-icon="i-mingcute-group-2-fill"
                  :active="onShared"
                  :count="withMe.length"
                  icon="i-mingcute-group-2-line"
                  label="Team"
                  to="/drops?tab=with-me"
                  @navigate="close"
                >
                  <!-- The carets' hit areas (before:) reach the row's full 32px, past their 24px square. -->
                  <button
                    :aria-expanded="teamOpen"
                    :aria-label="teamOpen ? 'Collapse team folders' : 'Expand team folders'"
                    class="relative grid size-6 cursor-pointer place-items-center rounded-sm text-dimmed before:absolute before:-inset-1 hover:bg-accented hover:text-highlighted"
                    type="button"
                    @click="teamOpen = !teamOpen"
                  >
                    <UIcon
                      name="i-mingcute-right-line"
                      class="size-3.5 motion-safe:transition-transform duration-150"
                      :class="teamOpen && 'rotate-90'"
                    />
                  </button>
                </SidebarItem>
                <div v-if="teamOpen" class="ml-3.5 border-l border-default pl-2">
                  <TeamTree @navigate="close" />
                </div>
              </template>
              <SidebarItem
                active-icon="i-mingcute-layers-fill"
                :active="onDrops"
                :count="dropCount"
                icon="i-mingcute-layers-line"
                :label="team ? 'My drops' : 'Drops'"
                to="/drops"
                @navigate="close"
              >
                <button
                  :aria-expanded="dropsOpen"
                  :aria-label="dropsOpen ? 'Collapse drops' : 'Expand drops'"
                  class="relative grid size-6 cursor-pointer place-items-center rounded-sm text-dimmed before:absolute before:-inset-1 hover:bg-accented hover:text-highlighted"
                  type="button"
                  @click="dropsOpen = !dropsOpen"
                >
                  <UIcon
                    name="i-mingcute-right-line"
                    class="size-3.5 motion-safe:transition-transform duration-150"
                    :class="dropsOpen && 'rotate-90'"
                  />
                </button>
              </SidebarItem>
              <div v-if="dropsOpen" class="ml-3.5 border-l border-default pl-2">
                <DropTree @navigate="close" />
              </div>
              <SidebarItem
                v-if="!team"
                active-icon="i-mingcute-inbox-fill"
                :active="onShared"
                :count="withMe.length"
                icon="i-mingcute-inbox-line"
                label="Shared with me"
                to="/drops?tab=with-me"
                @navigate="close"
              />
              <template v-if="teams">
                <SidebarItem
                  active-icon="i-mingcute-group-2-fill"
                  :active="route.path === '/teams'"
                  :count="teams.length"
                  icon="i-mingcute-group-2-line"
                  label="Teams"
                  to="/teams"
                  @navigate="close"
                />
                <div v-for="item in teams" :key="item.id" class="ml-3.5 border-l border-default pl-2">
                  <NuxtLink
                    class="flex h-7 items-center rounded-md px-2 text-xs font-medium text-muted hover:bg-accented/60 hover:text-highlighted"
                    :class="at(`/teams/${item.id}`) && 'text-highlighted'"
                    :to="`/teams/${item.id}`"
                    @click="close"
                    >{{ item.name }}</NuxtLink
                  >
                  <TeamTree :team="item.id" @navigate="close" />
                </div>
              </template>
            </nav>

            <div class="flex flex-col gap-0.5 border-t border-default pt-2">
              <SidebarItem v-for="link in workspace" :key="link.to" v-bind="link" @navigate="close" />
              <SidebarItem
                active-icon="i-mingcute-book-6-fill"
                :active="inDocs"
                icon="i-mingcute-book-6-line"
                label="Docs"
                trailing-icon="i-mingcute-right-line"
                @focusin="preloadDocs"
                @navigate="openDocs"
                @pointerenter="preloadDocs"
              />
            </div>
          </div>

          <!-- The wrapper carries the curtain (main.css): the nav inside scrolls, which would clip it. -->
          <div v-else key="docs" class="sidebar-pane-docs relative z-10 flex min-h-0 w-full min-w-0 bg-muted">
            <nav aria-label="Docs" class="flex min-h-0 w-full min-w-0 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
              <SidebarItem
                active-icon="i-mingcute-arrow-left-line"
                :active="false"
                icon="i-mingcute-arrow-left-line"
                label="Back"
                @navigate="leaveDocs"
              />
              <p class="label-mono mt-2 flex h-8 shrink-0 items-center px-2">Docs</p>
              <DocsTree @navigate="close" />
            </nav>
          </div>
        </Transition>
      </div>

      <template #footer>
        <UpdateReady />
        <UserMenu />
      </template>
    </UDashboardSidebar>

    <slot />

    <SearchPalette />
    <ShortcutsModal />
  </UDashboardGroup>
</template>
