<script setup lang="ts">
// The public pages' header (landing and docs): marks on the left; Docs, theme, GitHub, and sign-in on the right.
// Signed in, Open Drop and the account menu (theme, Sign out) take the place of the theme button and Sign in.
withDefaults(defineProps<{ wide?: boolean }>(), { wide: false })

const route = useRoute()
const { signedIn, signInWithGitHub } = useGitHubSignIn()
const dev = import.meta.dev
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
          size="sm"
          label="Docs"
          to="/docs"
          :class="route.path.startsWith('/docs') ? 'text-highlighted' : 'text-muted'"
        />
        <!-- Signed in, the theme switch moves into the account menu, next to Sign out. -->
        <ClientOnly v-if="!signedIn">
          <UColorModeButton size="sm" />
          <template #fallback><span class="size-8" /></template>
        </ClientOnly>
        <LandingGitHubStars />
        <template v-if="signedIn">
          <UButton class="ml-1" color="neutral" variant="outline" size="sm" label="Open Drop" to="/drops" />
          <UserMenu compact />
        </template>
        <!-- `nuxt dev` has no GitHub app: /signin has the email form there. -->
        <UButton v-else-if="dev" class="ml-1" color="neutral" variant="outline" size="sm" label="Sign in" to="/signin" />
        <UButton v-else class="ml-1" color="neutral" variant="outline" size="sm" label="Sign in" @click="signInWithGitHub" />
      </div>
    </div>
  </header>
</template>
