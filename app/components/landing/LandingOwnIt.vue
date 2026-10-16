<script setup lang="ts">
// Self-hosting, the ViteHub way: one config, your provider, your data.
const POINTS = [
  "GitHub sign-in by default. It's Better Auth underneath, so you can switch to Google, GitLab, email, or SSO",
  "On Cloudflare, the database and file storage are created on deploy",
  "MCP server with browser sign-in for your agents",
]
const CONFIG_FILE = "nuxt.config.ts"
const CONFIG = `export default defineNuxtConfig({
  modules: ["@nuxt/ui", "vite-hub/nuxt"],
  vitehub: {
    preset: "cloudflare",
    auth: true,      // Better Auth, GitHub by default
    database: true,  // drops, comments, members
    blob: true,      // files and app bundles
  },
})`
const COMMANDS = ["npx giget gh:vite-hub/drop my-drop", "cd my-drop && pnpm install", "pnpm run deploy"]
</script>

<template>
  <section id="own" class="scroll-mt-14 border-y border-default bg-muted">
    <div class="mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 sm:px-6 lg:py-32 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div>
        <p class="label-mono flex items-center gap-2"><ViteHubMark class="size-3" />Built on ViteHub</p>
        <h2 class="mt-3 text-[2rem] leading-tight font-semibold tracking-tight text-highlighted">You own it.</h2>
        <p class="mt-3 max-w-[44ch] leading-relaxed text-muted">
          Drop is a ViteHub template. Fork it, deploy it to your own account, and every drop and comment stays in your account.
        </p>
        <ul class="mt-6 space-y-2.5 text-sm">
          <li v-for="point in POINTS" :key="point" class="flex gap-2.5">
            <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-muted" />{{ point }}
          </li>
        </ul>
        <p class="label-mono mt-8 mb-3">Deploys to</p>
        <ul class="flex flex-wrap gap-1.5">
          <li v-for="host in HOSTS" :key="host.id">
            <NuxtLink :to="`/docs/self-host/${host.id}`" class="flex items-center gap-1.5 rounded-md border border-default bg-default px-2 py-1 text-xs text-toned transition-colors hover:text-highlighted">
              <UIcon :name="host.icon" class="size-3.5" />{{ host.id === "vps" ? "Your server" : host.name }}
            </NuxtLink>
          </li>
        </ul>
        <p class="mt-2.5 text-xs text-dimmed">Live editing runs on Cloudflare and on your own server.</p>
        <div class="mt-8 flex flex-wrap gap-2">
          <UButton color="neutral" variant="outline" icon="i-simple-icons-github" label="Fork on GitHub" to="https://github.com/vite-hub/drop" target="_blank" />
          <UButton color="neutral" variant="ghost" label="Self-hosting guide" to="/docs/self-host" />
        </div>
      </div>

      <div class="min-w-0 overflow-hidden rounded-xl border border-default bg-default shadow-xl shadow-black/4">
        <div class="flex h-10 items-center gap-2 border-b border-default px-4 font-mono text-xs text-muted">
          <span class="flex gap-1.5"><span v-for="dot in 3" :key="dot" class="size-2.5 rounded-full bg-accented" /></span>
          <span class="ml-2">{{ CONFIG_FILE }}</span>
        </div>
        <pre class="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-highlighted"><code>{{ CONFIG }}</code></pre>
        <div class="overflow-x-auto border-t border-default bg-muted p-5 font-mono text-[13px] leading-relaxed text-highlighted">
          <p v-for="command in COMMANDS" :key="command" class="whitespace-nowrap"><span class="text-muted select-none">$ </span>{{ command }}</p>
        </div>
      </div>
    </div>
  </section>
</template>
