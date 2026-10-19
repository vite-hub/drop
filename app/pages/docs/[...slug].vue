<script setup lang="ts">
import type { Component } from "vue"
import { MarkdownDocument } from "@comark/vue"
import { createContentClient } from "vite-hub/content/client"
import DocsDeployButtons from "~/components/docs/DocsDeployButtons.vue"
import DocsEnv from "~/components/docs/DocsEnv.vue"
import DocsFigure from "~/components/docs/Figure.vue"
import DocsHostFacts from "~/components/docs/DocsHostFacts.vue"

// Every docs page is Markdown in content/docs, served by ViteHub Content (server/content.ts). Tags in the Markdown,
// such as `::docs-env` or `:kbd[R]`, render with the components in components/docs/md, or Drop's Docs components.
// The docs layout comes from the `/docs/**` route rule (nuxt.config.ts).

// Landing stories stand in for screenshots on the Features page, and hydrate only once they scroll into view.
const LandingDocStory = defineLazyHydrationComponent(
  "visible",
  () => import("~/components/landing/LandingDocStory.vue"),
)
const LandingSiteStory = defineLazyHydrationComponent(
  "visible",
  () => import("~/components/landing/LandingSiteStory.vue"),
)
const MD = import.meta.glob<Component>("~/components/docs/md/*.vue", { import: "default", eager: true })
const components = {
  ...Object.fromEntries(
    Object.entries(MD).map(([path, component]) => [
      path
        .split("/")
        .pop()!
        .replace(/\.vue$/, ""),
      component,
    ]),
  ),
  DocsDeployButtons,
  DocsEnv,
  DocsFigure,
  DocsHostFacts,
  LandingDocStory,
  LandingSiteStory,
}

const route = useRoute()
const path = computed(() => `/${[route.params.slug ?? []].flat().join("/")}`.replace(/\/$/, "") || "/")
// SAFETY: Nuxt's $fetch is ofetch, which the content client calls with a path and fetch options; only its types differ.
const docs = createContentClient("docs", { fetch: $fetch as never })
const { data: doc } = await useAsyncData(
  () => `docs:${path.value}`,
  () => docs.get(path.value),
)
if (!doc.value) throw createError({ status: 404, statusText: "No docs page here." })
</script>

<template>
  <DocsPage v-if="doc" :title="String(doc.data.title)" :lead="String(doc.data.description)">
    <MarkdownDocument :value="doc" :components="components" class="docs-prose docs-markdown" />
  </DocsPage>
</template>
