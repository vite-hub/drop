<script setup lang="ts">
import geist from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url"
import { provideRelativeNow } from "vite-hub/ui"

provideRelativeNow(useRelativeNow())

const origin = useRequestURL().origin
useSeoMeta({
  titleTemplate: (title) => (title && title !== "Drop" ? `${title} · Drop` : "Drop"),
  ogSiteName: "Drop",
  ogTitle: "The shared drive for people and agents",
  ogDescription:
    "Drop docs, sites, and small apps. People and agents review, comment, revise, and share every version in one place.",
  ogImage: `${origin}/og.png`,
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageAlt: "Drop: the shared drive for people and agents.",
  twitterCard: "summary_large_image",
})

const route = useRoute()
const canonical = computed(() =>
  isIndexedPath(route.path) ? `${origin}${route.path.length > 1 ? route.path.replace(/\/+$/, "") : "/"}` : undefined,
)
useSeoMeta({ ogUrl: canonical })
useHead({ link: () => (canonical.value ? [{ rel: "canonical", href: canonical.value }] : []) })
useHead({ link: [{ rel: "preload", as: "font", type: "font/woff2", href: geist, crossorigin: "anonymous" }] })
</script>

<template>
  <UApp :toaster="{ position: 'bottom-center', progress: false }">
    <QuotaNotice />
    <StatusNote />
    <CommentsRecovery />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
