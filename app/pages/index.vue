<script setup lang="ts">
import { ROLE_LABELS, ROLE_SUMMARY, ROLES } from "#shared/roles"

useSeoMeta({
  title: "The shared drive for people and agents",
  description: "Drop docs, sites, and small apps. People and agents review, comment, revise, and share every version in one place.",
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

const FEATURES = [
  { icon: "i-lucide-layers", title: "Docs and apps", body: "Markdown, HTML with scripts, Mermaid, or a folder of static files. All full screen, all versioned." },
  { icon: "i-lucide-message-circle", title: "Comments on the exact spot", body: "Select a sentence or zoom into a screenshot and pin it. Copy everything back as Markdown." },
  { icon: "i-lucide-lock", title: "Private until shared", body: "One switch makes a link. Pick what it allows: view, comment, or edit." },
  { icon: "i-lucide-bot", title: "Agents make the changes", body: "People comment. The agent reads the open threads and drops the next version." },
  { icon: "i-lucide-users", title: "Edit together", body: "Change a Markdown doc with others, live, in a Notion-like editor. Publish makes it the next version." },
  { icon: "i-lucide-plug", title: "MCP built in", body: "Streamable HTTP on the latest spec. OAuth sign-in, the skill included, no keys to paste." },
  { icon: "i-lucide-history", title: "Every version kept", body: "Agents drop the next version of a doc or app. Older ones stay one click away." },
]

const PROMISES = ["Free and open source", "Private until shared", "Every version kept"]

const HOSTED = ["Sign in with GitHub", "Private by default", "Agents connect over MCP"]
</script>

<template>
  <div class="min-h-dvh bg-default text-default">
    <SiteHeader />

    <main>
      <section class="relative overflow-hidden">
        <LandingDotGrid class="absolute inset-0 size-full [mask-image:radial-gradient(ellipse_at_50%_0%,black_10%,transparent_60%)]" />
        <div class="relative mx-auto w-full max-w-5xl px-4 pt-16 pb-16 sm:px-6 lg:pt-24">
          <div class="flex flex-col items-center text-center">
            <NuxtLink to="/docs" class="mb-6 flex items-center gap-2 rounded-full border border-default bg-default py-1 pr-3 pl-1 text-xs text-muted transition-colors hover:text-highlighted">
              <span class="rounded-full bg-elevated px-2 py-0.5 font-mono text-[10px] tracking-wide text-highlighted uppercase">MCP</span>
              Connect Claude Code, Codex, or any agent
              <UIcon name="i-lucide-arrow-right" class="size-3" />
            </NuxtLink>
            <h1 class="max-w-[17ch] text-[clamp(2.5rem,6vw,4.25rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-highlighted">
              The shared drive for work you make together.
            </h1>
            <p class="mt-6 max-w-[52ch] text-lg leading-relaxed text-pretty text-muted">
              Drop docs, sites, and small apps. Review the live page, comment on the exact spot, and keep every version as the work moves back and forth.
            </p>
            <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
              <UButton v-if="signedIn" color="neutral" size="lg" class="h-10 px-4" label="Open Drop" trailing-icon="i-lucide-arrow-right" to="/drops" />
              <UButton v-else color="neutral" size="lg" class="h-10 px-4" icon="i-simple-icons-github" label="Sign in with GitHub" @click="signInWithGitHub" />
              <UButton color="neutral" variant="outline" size="lg" class="h-10 px-4" label="Read the docs" to="/docs" />
            </div>
            <p class="label-mono mt-5 flex flex-wrap justify-center gap-x-4 gap-y-1 text-dimmed">
              <span v-for="item in PROMISES" :key="item">{{ item }}</span>
            </p>

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
        <div class="mx-auto flex max-w-5xl items-center gap-6 px-4 py-5 sm:px-6">
          <span class="label-mono shrink-0">Works with</span>
          <LazyLandingLogoLoop class="min-w-0 flex-1" hydrate-on-visible>
            <span v-for="name in AGENTS" :key="name" class="flex shrink-0 items-center gap-2 text-sm text-muted">
              <AgentIcon :name="name" kind="agent" class="size-4" />{{ name }}
            </span>
            <span class="shrink-0 text-sm text-muted">Any MCP client</span>
          </LazyLandingLogoLoop>
        </div>
      </section>

      <section class="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <div class="mb-8 max-w-xl">
          <p class="label-mono mb-2">Pull requests</p>
          <h2 class="text-2xl font-semibold tracking-tight text-highlighted">Review the change, not only the diff.</h2>
          <p class="mt-2 text-sm leading-relaxed text-muted">Claude Code drops before and after screenshots with its notes and links them from the pull request. Reviewers see what changed and comment on the exact spot.</p>
        </div>
        <LazyLandingPrStory hydrate-on-visible />
      </section>

      <section class="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <div class="mb-8 max-w-xl">
          <p class="label-mono mb-2">Vibe-coded apps</p>
          <h2 class="text-2xl font-semibold tracking-tight text-highlighted">Ship the thing you just made.</h2>
          <p class="mt-2 text-sm leading-relaxed text-muted">Ask for a prototype, a tool, or a small game. Your agent publishes the folder and the link runs it. This one's real, so try it.</p>
        </div>
        <LazyLandingAppStory hydrate-on-visible />
      </section>

      <section class="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <div class="mb-6 max-w-xl">
          <p class="label-mono mb-2">A live page for every file</p>
          <h2 class="text-2xl font-semibold tracking-tight text-highlighted">Everything around the review.</h2>
        </div>
        <div class="grid gap-px overflow-hidden rounded-lg border border-default bg-(--ui-border) sm:grid-cols-2 lg:grid-cols-3">
          <LazyLandingSpotlightCard v-for="feature in FEATURES" :key="feature.title" class="p-6" hydrate-on-interaction="pointerenter">
            <UIcon :name="feature.icon" class="size-4 text-muted" />
            <p class="mt-3 font-medium text-highlighted">{{ feature.title }}</p>
            <p class="mt-1.5 text-sm leading-relaxed text-muted">{{ feature.body }}</p>
          </LazyLandingSpotlightCard>
        </div>
      </section>

      <!-- Below the fold: rendered on the server, hydrated only when scrolled into view. -->
      <LazyLandingOwnIt hydrate-on-visible />

      <section class="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <h2 class="mb-6 text-2xl font-semibold tracking-tight text-highlighted">Use it here, or run your own</h2>
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
            <p class="mt-3 text-lg font-medium tracking-tight text-highlighted">Deploy it, name the admins. Three roles.</p>
            <p class="mt-2 text-sm leading-relaxed text-muted">Everyone joins as {{ ROLE_LABELS.member }}. The GitHub accounts you list as admins can promote anyone.</p>
            <dl class="mt-5 divide-y divide-default border-y border-default text-sm">
              <div v-for="role in ROLES" :key="role" class="flex gap-4 py-2">
                <dt class="w-16 shrink-0 font-medium text-highlighted">{{ ROLE_LABELS[role] }}</dt>
                <dd class="text-muted">{{ ROLE_SUMMARY[role] }}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-5xl px-4 pt-4 pb-20 sm:px-6">
        <div class="flex flex-col items-start justify-between gap-6 rounded-lg border border-default p-8 sm:flex-row sm:items-center">
          <div>
            <p class="text-xl font-semibold tracking-tight text-highlighted">Keep the loop in one place.</p>
            <p class="mt-1 text-sm text-muted">Free and open source. Let people and agents work in the same drop.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton color="neutral" variant="ghost" label="Read the source" to="https://github.com/vite-hub/drop" target="_blank" />
            <UButton color="neutral" variant="outline" label="Open Drop" to="/drops" />
          </div>
        </div>
      </section>
    </main>

    <SiteFooter />
  </div>
</template>
