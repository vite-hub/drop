<script setup lang="ts">
// What someone with the link sees: the doc's latest version, or the one `?v=` pins, full screen, no sidebar. Private
// drops 404. Signed-in people read it inside the app instead, so the link never strands them; opened straight away, it
// keeps the sidebar out of the way until they ask for it (useOpenedOnLink).
// The address settles on the doc's link (`/d/<link>/<slug>`): an outdated slug moves there.
import { type DropLink, dropPath } from "#shared/links"
import { isPublic } from "#shared/share"

definePageMeta({
  middleware: async (to) => {
    const { data: me } = await useMe()
    // `?present` shows the drop alone, for another window (ViewerPresent), signed in or not.
    if (me.value && to.query.present === undefined) setPageLayout("dashboard")
  },
})

const route = useRoute("d-id-slug")
const { data: me } = await useMe()
const pinned = computed(() => Number(route.query.v) || undefined)
const presenting = computed(() => route.query.present !== undefined)
const target = await useApi<DropLink>(() => `/api/links/${route.params.id}`, {
  key: () => keys.dropLink(route.params.id, pinned.value),
  query: computed(() => (pinned.value ? { v: pinned.value } : {})),
})

async function settle() {
  const link = target.data.value
  if (!link || route.path === dropPath(link)) return
  await navigateTo(
    { path: dropPath(link), query: { ...route.query, ...(link.from ? { from: link.from } : {}) } },
    { replace: true },
  )
}
await settle()
watch(() => target.data.value, settle)

// Until the link resolves (or when it can't), the drop API answers for the key itself and says why it can't open.
const { drop, comments } = provideDrop(
  () => target.data.value?.id ?? route.params.id,
  () =>
    target.data.value && target.data.value.version !== target.data.value.latest ? target.data.value.version : undefined,
)
await Promise.all([drop, comments])
useSeoMeta({ title: () => drop.data.value?.title ?? "Drop", robots: "noindex, nofollow" })
// A pasted link's preview names the drop. Unfurlers aren't signed in, so only public drops reach them; the rest keep
// app.vue's Drop card. The card image is the drop's own (server/routes/og/[id].get.ts).
const origin = useRequestURL().origin
const shown = computed(() => (drop.data.value && isPublic(drop.data.value.share) ? drop.data.value : null))
useSeoMeta({
  ogTitle: () => shown.value?.title,
  description: () => shown.value && (shown.value.excerpt ?? "Shared on Drop."),
  ogDescription: () => shown.value && (shown.value.excerpt ?? "Shared on Drop."),
  ogImage: () => shown.value && `${origin}/og/${shown.value.id}.png`,
  ogImageAlt: () => shown.value?.title,
  ogType: () => shown.value && "article",
})
// The doc renders in a frame once the page's script runs; agents reading the HTML find its text here instead.
useHeadSafe({
  link: () =>
    ["markdown", "html"].includes(drop.data.value?.kind ?? "")
      ? [
          {
            rel: "alternate",
            type: "text/markdown",
            href: `${route.path}.md${pinned.value ? `?v=${pinned.value}` : ""}`,
          },
        ]
      : [],
})
// A visit beacon: unfurlers and crawlers never run this, so only people reading the link keep the drop alive.
onMounted(() => drop.data.value && $fetch(`/api/drops/${drop.data.value.id}/visit`, { method: "POST" }).catch(() => {}))
const waiting = computed(() => waitingForReview(drop.error.value))
const here = useHerePath()
</script>

<template>
  <ViewerPresent v-if="presenting && drop.data.value" :key="`${drop.data.value.id}@${drop.data.value.version}`" />
  <!-- The dashboard layout brings its own UDashboardGroup; a visitor's page needs one for the viewer's panels. -->
  <template v-else-if="me">
    <DropViewer v-if="drop.data.value" :key="`${drop.data.value.id}@${drop.data.value.version}`" public-view />
    <UDashboardPanel v-else id="drop-missing">
      <template #header>
        <!-- The viewer's bar while it loads or can't open, so the page keeps its line and doesn't jump. -->
        <UDashboardNavbar :ui="{ root: 'h-12 gap-2 px-2 sm:px-3' }">
          <template #left>
            <SidebarExpand />
            <UButton
              aria-label="Back to drops"
              color="neutral"
              icon="i-mingcute-arrow-left-line"
              size="sm"
              variant="ghost"
              to="/drops"
            />
          </template>
        </UDashboardNavbar>
      </template>
      <template #body>
        <ContentUnavailable :status="drop.error.value?.status ?? 500" :path="here" :waiting-for-review="waiting" />
      </template>
    </UDashboardPanel>
  </template>
  <UDashboardGroup v-else-if="drop.data.value" unit="rem" storage="cookie" storage-key="drop-public">
    <DropViewer :key="`${drop.data.value.id}@${drop.data.value.version}`" public-view />
    <ShortcutsModal />
  </UDashboardGroup>
  <ContentUnavailable
    v-else
    class="min-h-dvh"
    :status="drop.error.value?.status ?? 500"
    :path="here"
    :waiting-for-review="waiting"
  />
</template>
