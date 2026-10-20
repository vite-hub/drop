<script setup lang="ts">
// The docs: signed-in people keep the app's sidebar, where Docs expands into the section nav; signed-out visitors
// get the landing's header and footer with the section nav beside the page.
import DashboardLayout from "./dashboard.vue"

const route = useRoute()
const active = (to: string) => isActivePath(route.path, to)
const current = computed(() => DOCS_PAGES.find((page) => active(page.to)))
const menuOpen = ref(false)
watch(
  () => route.path,
  () => (menuOpen.value = false),
)
// From /api/me, which SSR fetches with the session cookie, so the server picks the right shell.
const { data: me } = await useMe()

// Signed in, the page scrolls inside the dashboard panel, not the window, so the router's scroll to a #section misses.
function scrollToHash() {
  if (me.value && route.hash) document.getElementById(decodeURIComponent(route.hash.slice(1)))?.scrollIntoView()
}
onMounted(scrollToHash)
onScopeDispose(useNuxtApp().hook("page:finish", () => nextTick(scrollToHash)))
watch(() => route.hash, scrollToHash, { flush: "post" })
</script>

<template>
  <DashboardLayout v-if="me">
    <UDashboardPanel id="docs" :ui="{ body: 'p-0 sm:p-0 gap-0' }">
      <template #header>
        <!-- The h-12 bar of every app page (PageShell), here a breadcrumb: the page's own h1 is in the prose, so the
             bar's #left replaces its title h1. The menu toggle sits outside #left. -->
        <UDashboardNavbar :ui="{ root: 'h-12 gap-2 px-4 lg:px-6' }">
          <template #left>
            <SidebarExpand />
            <p class="flex min-w-0 items-center gap-1.5 text-sm">
              <span class="text-muted">Docs</span>
              <template v-if="current">
                <UIcon name="i-mingcute-right-line" class="size-3.5 shrink-0 text-dimmed" />
                <span class="truncate font-medium text-highlighted">{{ current.label }}</span>
              </template>
            </p>
          </template>
        </UDashboardNavbar>
      </template>
      <template #body>
        <!-- The sidebar's Docs item carries the section nav, so the page is prose alone. -->
        <main class="mx-auto w-full max-w-3xl px-6 pt-6 pb-20 lg:px-8">
          <slot />
        </main>
      </template>
    </UDashboardPanel>
  </DashboardLayout>

  <div v-else class="flex min-h-dvh flex-col bg-default text-default">
    <SiteHeader wide />

    <div class="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-14">
      <!-- Small screens: the nav folds into a menu above the page. -->
      <div class="border-b border-default py-3 lg:hidden">
        <button
          class="flex w-full items-center justify-between text-sm text-muted"
          type="button"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          <span>{{ current?.label ?? "Docs" }}</span>
          <UIcon :name="menuOpen ? 'i-mingcute-up-line' : 'i-mingcute-down-line'" class="size-4" />
        </button>
        <DocsNav v-if="menuOpen" class="pt-4 pb-2" />
      </div>

      <aside class="hidden lg:block">
        <DocsNav class="sticky top-14 max-h-[calc(100dvh-3.5rem)] overflow-y-auto py-12" />
      </aside>

      <main class="min-w-0 pt-10 pb-20 lg:pt-12">
        <slot />
      </main>
    </div>

    <SiteFooter wide />
  </div>
</template>
