<script setup lang="ts">
// The public pages' header (landing and docs): marks on the left; Docs, theme, GitHub, and sign-in on the right.
withDefaults(defineProps<{ wide?: boolean }>(), { wide: false })

const colorMode = useColorMode()
const dark = computed(() => colorMode.value === "dark")
const toggleTheme = () => (colorMode.preference = dark.value ? "light" : "dark")

const route = useRoute()
const { signedIn, signInWithGitHub } = useGitHubSignIn()
</script>

<template>
  <header class="sticky top-0 z-30 border-b border-default bg-default">
    <div class="mx-auto flex h-14 items-center gap-3 px-4 sm:gap-4 sm:px-6" :class="wide ? 'max-w-6xl' : 'max-w-5xl'">
      <div class="flex items-center gap-2.5">
        <NuxtLink class="flex items-center gap-2 font-semibold tracking-tight text-highlighted" to="/">
          <DropMark class="h-5 w-7" />
          <span>Drop</span>
        </NuxtLink>
        <span aria-hidden="true" class="text-lg font-light text-(--ui-border-accented)">/</span>
        <a aria-label="ViteHub" class="flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-highlighted" href="https://vitehub.dev" rel="noreferrer" target="_blank">
          <ViteHubMark class="size-3.5" /><span class="hidden sm:inline">ViteHub</span>
        </a>
      </div>
      <div class="ml-auto flex items-center gap-1">
        <UButton
          color="neutral"
          variant="ghost"
          label="Docs"
          to="/docs"
          :class="route.path.startsWith('/docs') ? 'text-highlighted' : 'text-muted'"
        />
        <ClientOnly>
          <UButton
            color="neutral"
            variant="ghost"
            :icon="dark ? 'i-lucide-sun' : 'i-lucide-moon'"
            :aria-label="dark ? 'Switch to light theme' : 'Switch to dark theme'"
            @click="toggleTheme"
          />
          <template #fallback><span class="size-8" /></template>
        </ClientOnly>
        <LandingGitHubStars />
        <UButton v-if="signedIn" class="ml-1" color="neutral" variant="outline" label="Open Drop" to="/drops" />
        <UButton v-else class="ml-1" color="neutral" variant="outline" label="Sign In" @click="signInWithGitHub" />
      </div>
    </div>
  </header>
</template>
