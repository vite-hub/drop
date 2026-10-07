<script setup lang="ts">
// One docs page: its H1 and lead, the sections, and links to the previous and next pages.
const props = defineProps<{ title: string; lead: string }>()

const route = useRoute()
const index = computed(() => DOCS_PAGES.findIndex(page => page.to === route.path.replace(/\/$/, "") || (page.to === "/docs" && route.path === "/docs/")))
const previous = computed(() => (index.value > 0 ? DOCS_PAGES[index.value - 1] : undefined))
const next = computed(() => (index.value >= 0 ? DOCS_PAGES[index.value + 1] : undefined))

useSeoMeta({ title: () => props.title, description: () => props.lead, ogTitle: () => `${props.title} · Drop`, ogDescription: () => props.lead })
</script>

<template>
  <article class="max-w-3xl">
    <header class="mb-10">
      <h1 class="text-[2rem] leading-tight font-semibold tracking-tight text-highlighted">{{ title }}</h1>
      <p class="mt-3 text-base leading-relaxed text-muted">{{ lead }}</p>
    </header>

    <div class="space-y-10">
      <slot />
    </div>

    <nav v-if="previous || next" aria-label="Pages" class="mt-16 grid gap-3 border-t border-default pt-6 sm:grid-cols-2">
      <NuxtLink v-if="previous" :to="previous.to" class="group rounded-lg border border-default p-4 transition-colors hover:bg-elevated">
        <span class="label-mono">Previous</span>
        <span class="mt-1 block text-sm font-medium text-highlighted">{{ previous.label }}</span>
      </NuxtLink>
      <span v-else />
      <NuxtLink v-if="next" :to="next.to" class="group rounded-lg border border-default p-4 text-right transition-colors hover:bg-elevated">
        <span class="label-mono">Next</span>
        <span class="mt-1 block text-sm font-medium text-highlighted">{{ next.label }}</span>
      </NuxtLink>
    </nav>
  </article>
</template>
