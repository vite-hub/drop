<script setup lang="ts">
import { promiseTimeout } from "@vueuse/core"
import { RETURNING_COOKIE } from "#shared/sign-in"

const route = useRoute()
const consoleAuth = consoleUrl("/auth")
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
providePaletteContext()

const onDrops = computed(() => route.path === "/drops" && route.query.tab !== "with-me")
const onShared = computed(() => route.path === "/drops" && route.query.tab === "with-me")
const teamOpen = ref(true)
const { data: me } = useMe()
const returning = useCookie(RETURNING_COOKIE, { maxAge: 60 * 60 * 24 * 365, sameSite: "lax" })
if (me.value && !returning.value) returning.value = "1"
const team = computed(() => me.value?.mode === "team")
const teams = computed(() => me.value?.teams ?? null)
const { total: dropCount } = useSidebarDrops()
const { data: shared } = useSharedWithMe()
const withMe = computed(() => (team.value ? shared.value : shared.value.filter((drop) => !drop.team)))
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
          to: consoleAuth,
          target: "_blank",
          active: false,
        },
      ]
    : []),
])

const inDocs = computed(() => at("/docs") || DOCS_PAGES.some((page) => isActivePath(route.path, page.to)))
const pane = ref<"main" | "docs">(inDocs.value ? "docs" : "main")
const slide = ref<"forward" | "back">("forward")
const SLIDE_MS = 220
const motion = usePreferredReducedMotion()
async function openDocs() {
  slide.value = "forward"
  pane.value = "docs"
  if (inDocs.value) return
  await promiseTimeout(motion.value === "reduce" ? 0 : SLIDE_MS)
  if (pane.value === "docs") await navigateTo("/docs")
}
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

      <UDashboardSearchButton class="mb-2 w-full text-muted" label="Search" size="sm" />

      <div class="relative -mx-2 flex min-h-0 flex-1 overflow-hidden">
        <Transition :name="`sidebar-${slide}`">
          <div v-if="pane === 'main'" key="main" class="flex min-h-0 w-full min-w-0 flex-col bg-muted px-2">
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
                <SidebarNew />
              </SidebarItem>
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
        <ClientOnly><SidebarUsage /></ClientOnly>
        <UpdateReady />
        <UserMenu />
      </template>
    </UDashboardSidebar>

    <slot />

    <SearchPalette />
    <ShortcutsModal />
  </UDashboardGroup>
</template>
