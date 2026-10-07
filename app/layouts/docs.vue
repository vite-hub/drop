<script setup lang="ts">
// The public docs: the landing's header and footer around a section nav and one page of prose.
const route = useRoute()
const active = (to: string) => route.path === to || route.path === `${to}/`
const current = computed(() => DOCS_PAGES.find(page => active(page.to)))
const menuOpen = ref(false)
watch(() => route.path, () => (menuOpen.value = false))
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-default text-default">
    <SiteHeader wide />

    <div class="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6 lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-14">
      <!-- Small screens: the nav folds into a menu above the page. -->
      <div class="border-b border-default py-3 lg:hidden">
        <button class="flex w-full items-center justify-between text-sm text-muted" type="button" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen">
          <span>{{ current?.label ?? "Docs" }}</span>
          <UIcon :name="menuOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4" />
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
