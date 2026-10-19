<script setup lang="ts">
// Link previews need an absolute image URL, so it follows whichever host serves Drop.
const origin = useRequestURL().origin
useSeoMeta({
  titleTemplate: title => (title && title !== "Drop" ? `${title} · Drop` : "Drop"),
  ogSiteName: "Drop",
  ogTitle: "The shared drive for people and agents",
  ogDescription: "Drop docs, sites, and small apps. People and agents review, comment, revise, and share every version in one place.",
  ogImage: `${origin}/og.png`,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: "Drop: the shared drive for people and agents.",
  twitterCard: "summary_large_image",
})

// The pages search engines index (INDEXED_PATHS) name their one address, without a query or trailing slash, so
// /?signin=1 and /docs/ count as / and /docs. The rest answer with noindex instead (server/plugins/content-headers.ts).
const route = useRoute()
const canonical = computed(() => (isIndexedPath(route.path) ? `${origin}${route.path.length > 1 ? route.path.replace(/\/+$/, "") : "/"}` : undefined))
useSeoMeta({ ogUrl: canonical })
useHead({ link: () => (canonical.value ? [{ rel: "canonical", href: canonical.value }] : []) })
</script>

<template>
  <UApp :toaster="{ position: 'bottom-center' }">
    <QuotaNotice />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
