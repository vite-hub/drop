<script setup lang="ts">
import { ROLE_LABELS, ROLE_SUMMARY, ROLES } from "#shared/roles"

useSeoMeta({
  title: "The shared drive for people and their agents",
  description: "Agents drop docs, pages, and small apps. People comment on the exact spot, and the agent drops the next version.",
})

const route = useRoute()
const { signedIn, next, signIn, signInWithGitHub } = useGitHubSignIn()

// `nuxt dev` has no GitHub app: /?signin=1 shows a tiny email form instead.
const devSignIn = computed(() => import.meta.dev && route.query.signin === "1")
const dev = reactive({ email: "", password: "", error: "", pending: false })
async function signInWithEmail() {
  dev.pending = true
  dev.error = ""
  const { error } = await signIn.email({ email: dev.email, password: dev.password, callbackURL: next.value })
  dev.pending = false
  if (error) dev.error = error.message ?? "Couldn't sign in."
  else {
    clearNuxtData("me")
    await navigateTo(next.value)
  }
}

const AGENTS = ["Claude Code", "Codex", "Cursor", "Copilot", "Gemini CLI", "Windsurf", "Zed", "opencode"]

// The first card is the point of Drop, so it gets two columns.
const FEATURES = [
  { icon: "i-lucide-bot", title: "Agents make the changes", body: "People comment. The agent reads the open comments over MCP and drops the next version, so nobody copies feedback into a chat by hand." },
  { icon: "i-lucide-layers", title: "Docs and apps", body: "Markdown, HTML with scripts, Mermaid, or a folder of static files. Each opens full screen at its own link." },
  { icon: "i-lucide-message-circle", title: "Comments on the exact spot", body: "Select a sentence or zoom into a screenshot and pin it. Copy everything back as Markdown." },
  { icon: "i-lucide-lock", title: "Private until shared", body: "One switch makes a link. Pick what it allows: view, comment, or edit." },
  { icon: "i-lucide-users", title: "Edit together", body: "Change a Markdown doc with others, live, in a Notion-like editor. Publish makes it the next version." },
  { icon: "i-lucide-plug", title: "MCP built in", body: "Add one URL to your agent and sign in through the browser. No API keys. The Drop skill comes with it." },
  { icon: "i-lucide-history", title: "Older versions one click back", body: "Each new version of a doc gets a number. Drops nobody opens for 30 days expire unless you keep them." },
]

const USE_CASES = [
  {
    story: "pr",
    label: "Pull requests",
    title: "Put the before and after in every pull request.",
    body: "Claude Code drops the screenshots with its notes and links them from the PR. Reviewers see what changed, then read the diff.",
  },
  {
    story: "app",
    label: "Vibe-coded apps",
    title: "Ship the thing you just made.",
    body: "Ask for a prototype, a tool, or a small game. Your agent publishes the folder and the link runs it. This one's real, so try it.",
  },
] as const

const SELF_HOSTED = [
  "Deploy to Cloudflare, Vercel, Netlify, Deno Deploy, or your own server",
  "GitHub sign-in by default. Switch to Google, GitLab, email, or SSO with Better Auth",
]

const HOSTED = ["Sign in with GitHub", "Agents connect over MCP", "Unopened drops expire after 30 days, unless you keep them"]
</script>

<template>
  <div class="min-h-dvh bg-default text-default">
    <SiteHeader wide />

    <main>
      <section class="relative overflow-hidden">
        <LandingDotGrid class="absolute inset-0 size-full [mask-image:radial-gradient(ellipse_at_50%_0%,black_10%,transparent_60%)]" />
        <div class="relative mx-auto w-full max-w-6xl px-4 pt-16 pb-24 sm:px-6 lg:pt-24 lg:pb-32">
          <div class="flex flex-col items-center text-center">
            <NuxtLink to="/docs/agents" class="mb-6 flex items-center gap-2 rounded-full border border-default bg-default py-1 pr-3 pl-1 text-xs text-muted transition-colors hover:text-highlighted">
              <span class="rounded-full bg-elevated px-2 py-0.5 font-mono text-[10px] tracking-wide text-highlighted uppercase">MCP</span>
              Connect Claude Code, Codex, or any agent
              <UIcon name="i-lucide-arrow-right" class="size-3" />
            </NuxtLink>
            <h1 class="max-w-[18ch] text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-highlighted">
              The shared drive for people and their agents.
            </h1>
            <p class="mt-6 max-w-[56ch] text-lg leading-relaxed text-pretty text-muted">
              Claude Code, Codex, or any MCP agent drops a doc, a page, or a small app. You comment on the exact spot, and the agent drops the next version.
            </p>
            <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
              <UButton v-if="signedIn" color="neutral" size="lg" class="h-10 px-4" label="Open Drop" trailing-icon="i-lucide-arrow-right" to="/drops" />
              <UButton v-else color="neutral" size="lg" class="h-10 px-4" icon="i-simple-icons-github" label="Sign in with GitHub" @click="signInWithGitHub" />
              <UButton color="neutral" variant="outline" size="lg" class="h-10 px-4" label="Read the docs" to="/docs" />
            </div>

            <form v-if="devSignIn && !signedIn" class="mt-6 flex w-full max-w-xs flex-col gap-2 rounded-lg border border-dashed border-accented bg-default p-3 text-left" @submit.prevent="signInWithEmail">
              <p class="label-mono">Dev sign-in</p>
              <UInput v-model="dev.email" autocomplete="email" placeholder="Email" size="sm" type="email" required />
              <UInput v-model="dev.password" autocomplete="current-password" placeholder="Password" size="sm" type="password" required />
              <UButton block color="neutral" variant="outline" size="sm" label="Sign in" :loading="dev.pending" type="submit" />
              <p v-if="dev.error" class="text-xs text-error" role="alert">{{ dev.error }}</p>
            </form>
          </div>
          <LandingHeroStory class="mt-14" />
        </div>
      </section>

      <section class="border-y border-default">
        <div class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-5 sm:px-6">
          <span class="label-mono shrink-0">Works with</span>
          <LazyLandingLogoLoop class="min-w-0 flex-1" hydrate-on-visible>
            <span v-for="name in AGENTS" :key="name" class="flex shrink-0 items-center gap-2 text-sm text-muted">
              <AgentIcon :name="name" kind="agent" class="size-4" />{{ name }}
            </span>
            <span class="shrink-0 text-sm text-muted">Any MCP client</span>
          </LazyLandingLogoLoop>
        </div>
      </section>

      <section v-for="useCase in USE_CASES" :key="useCase.label" class="mx-auto max-w-6xl px-4 pt-24 sm:px-6 lg:pt-32">
        <div class="mb-10 grid items-end gap-x-12 gap-y-3 lg:mb-12 lg:grid-cols-2">
          <div>
            <p class="label-mono mb-3">{{ useCase.label }}</p>
            <h2 class="text-3xl leading-tight font-semibold tracking-tight text-balance text-highlighted">{{ useCase.title }}</h2>
          </div>
          <p class="max-w-[52ch] leading-relaxed text-pretty text-muted">{{ useCase.body }}</p>
        </div>
        <div class="rounded-2xl border border-default bg-muted p-3 sm:p-8 lg:p-10">
          <LazyLandingPrStory v-if="useCase.story === 'pr'" hydrate-on-visible />
          <LazyLandingAppStory v-else hydrate-on-visible />
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
        <div class="mb-10 lg:mb-12">
          <p class="label-mono mb-3">A live page for every file</p>
          <h2 class="text-3xl font-semibold tracking-tight text-highlighted">What every drop gets.</h2>
        </div>
        <div class="grid gap-px overflow-hidden rounded-xl border border-default bg-(--ui-border) sm:grid-cols-2 lg:grid-cols-4">
          <LazyLandingSpotlightCard v-for="(feature, position) in FEATURES" :key="feature.title" class="p-6" :class="position === 0 && 'sm:col-span-2'" hydrate-on-interaction="pointerenter">
            <UIcon :name="feature.icon" class="size-4 text-muted" />
            <p class="mt-3 font-medium text-highlighted">{{ feature.title }}</p>
            <p class="mt-1.5 text-sm leading-relaxed text-muted">{{ feature.body }}</p>
          </LazyLandingSpotlightCard>
        </div>
      </section>

      <!-- Below the fold: rendered on the server, hydrated only when scrolled into view. -->
      <LazyLandingOwnIt hydrate-on-visible />

      <section class="mx-auto max-w-6xl px-4 pt-24 sm:px-6 lg:pt-32">
        <h2 class="mb-10 text-3xl font-semibold tracking-tight text-highlighted lg:mb-12">Use it here, or run your own.</h2>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="rounded-lg border border-default p-6">
            <p class="label-mono">drop.vitehub.dev</p>
            <p class="mt-3 text-lg font-medium tracking-tight text-highlighted">Sign in and start dropping.</p>
            <p class="mt-2 text-sm leading-relaxed text-muted">Anyone with a GitHub account can use it. Drops start private, and a link shares them only when you say so.</p>
            <ul class="mt-5 space-y-2 text-sm">
              <li v-for="item in HOSTED" :key="item" class="flex items-center gap-2">
                <UIcon name="i-lucide-check" class="size-4 text-muted" />{{ item }}
              </li>
            </ul>
          </div>
          <div class="rounded-lg border border-default p-6">
            <p class="label-mono">Your own</p>
            <p class="mt-3 text-lg font-medium tracking-tight text-highlighted">Deploy your own and choose the admins.</p>
            <p class="mt-2 text-sm leading-relaxed text-muted">Everyone joins as {{ ROLE_LABELS.member }}. The GitHub accounts you list as admins can promote anyone.</p>
            <ul class="mt-5 space-y-2 text-sm">
              <li v-for="item in SELF_HOSTED" :key="item" class="flex gap-2">
                <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-muted" />{{ item }}
              </li>
            </ul>
            <dl class="mt-5 divide-y divide-default border-y border-default text-sm">
              <div v-for="role in ROLES" :key="role" class="flex gap-4 py-2">
                <dt class="w-16 shrink-0 font-medium text-highlighted">{{ ROLE_LABELS[role] }}</dt>
                <dd class="text-muted">{{ ROLE_SUMMARY[role] }}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 pt-24 pb-24 sm:px-6 lg:pt-32 lg:pb-32">
        <div class="flex flex-col items-start justify-between gap-6 rounded-lg border border-default p-8 sm:flex-row sm:items-center">
          <div>
            <p class="text-xl font-semibold tracking-tight text-highlighted">Drop your first doc.</p>
            <p class="mt-1 text-sm text-muted">Sign in with GitHub, connect your agent, and ask it to drop something for review.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton color="neutral" variant="ghost" label="Read the source" to="https://github.com/vite-hub/drop" target="_blank" />
            <UButton v-if="signedIn" color="neutral" label="Open Drop" to="/drops" />
            <UButton v-else color="neutral" icon="i-simple-icons-github" label="Sign in with GitHub" @click="signInWithGitHub" />
          </div>
        </div>
      </section>
    </main>

    <SiteFooter wide />
  </div>
</template>
