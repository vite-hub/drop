<script setup lang="ts">
withDefaults(defineProps<{ wide?: boolean }>(), { wide: false })
</script>

<template>
  <footer class="border-t border-default">
    <div class="mx-auto flex w-full flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-muted sm:px-6" :class="wide ? 'max-w-6xl' : 'max-w-5xl'">
      <span class="flex items-center gap-2">
        <ViteHubMark class="size-3.5" />Built with
        <a class="font-medium text-highlighted hover:underline" href="https://vitehub.dev" rel="noreferrer" target="_blank">ViteHub</a>
      </span>
      <span class="flex flex-wrap gap-5">
        <NuxtLink class="hover:text-highlighted" to="/docs">Docs</NuxtLink>
        <NuxtLink class="hover:text-highlighted" to="/terms">Terms</NuxtLink>
        <NuxtLink class="hover:text-highlighted" to="/acceptable-use">Acceptable use</NuxtLink>
        <NuxtLink class="hover:text-highlighted" to="/abuse">Copyright and abuse</NuxtLink>
        <NuxtLink class="hover:text-highlighted" to="/docs/self-host">Self-host</NuxtLink>
        <a class="hover:text-highlighted" href="https://github.com/vite-hub/drop" rel="noreferrer" target="_blank">GitHub</a>
      </span>
    </div>
  </footer>
</template>
