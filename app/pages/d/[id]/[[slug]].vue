<script setup lang="ts">
import { type DropLink, dropPath } from "#shared/links"
import { isPublic } from "#shared/share"

definePageMeta({
  middleware: async (to) => {
    const { data: me } = await useMe()
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

const { drop, comments } = provideDrop(
  () => target.data.value?.id ?? route.params.id,
  () =>
    target.data.value && target.data.value.version !== target.data.value.latest ? target.data.value.version : undefined,
)
await Promise.all([drop, comments])
useSeoMeta({ title: () => drop.data.value?.title ?? "Drop", robots: "noindex, nofollow" })
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
onMounted(() => {
  const id = drop.data.value?.id
  if (id)
    $fetch(`/api/drops/${id}/visit`, { method: "POST" }).catch((error: unknown) =>
      reportClientError("visit", error, { drop: id }),
    )
})
const waiting = computed(() => waitingForReview(drop.error.value))
const here = useHerePath()
</script>

<template>
  <ViewerPresent v-if="presenting && drop.data.value" :key="`${drop.data.value.id}@${drop.data.value.version}`" />
  <template v-else-if="me">
    <DropViewer v-if="drop.data.value" :key="`${drop.data.value.id}@${drop.data.value.version}`" public-view />
    <UDashboardPanel v-else id="drop-missing">
      <template #header>
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
