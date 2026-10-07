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

const LOOP = [
  { n: "01", actor: "Codex", kind: "agent" as const, title: "Drops launch-board/", body: "A live app, private by default.", icon: "i-lucide-upload" },
  { n: "02", actor: "Ana", kind: "browser" as const, title: "Comments on the CTA", body: "Pinned to the exact spot in the page.", icon: "i-lucide-message-circle" },
  { n: "03", actor: "Codex", kind: "agent" as const, title: "Reads the open comments", body: "Then drops v2 with the change.", icon: "i-lucide-refresh-cw" },
  { n: "04", actor: "You", kind: "browser" as const, title: "Shares the link", body: "Choose view, comment, or edit.", icon: "i-lucide-share-2" },
]

const FEATURES = [
  { icon: "i-lucide-layers", title: "Docs and apps", body: "Markdown, HTML with scripts, Mermaid, or a folder of static files. All full screen, all versioned." },
  { icon: "i-lucide-message-circle", title: "Comments on the exact spot", body: "Select a sentence or zoom into a screenshot and pin it. Copy everything back as Markdown." },
  { icon: "i-lucide-lock", title: "Private until shared", body: "One switch makes a link. Pick what it allows: view, comment, or edit." },
  { icon: "i-lucide-pencil", title: "Edit in place", body: "A Notion-like editor for docs and a code view for apps, right where you review." },
  { icon: "i-lucide-plug", title: "MCP built in", body: "Streamable HTTP on the latest spec. OAuth sign-in, the skill included, no keys to paste." },
  { icon: "i-lucide-history", title: "Every version kept", body: "Agents drop the next version of a doc or app. Older ones stay one click away." },
]

const HOSTED = ["Sign in with GitHub", "Private by default", "Agents connect over MCP"]
</script>

<template>
  <div class="min-h-dvh bg-default text-default">
    <SiteHeader />

    <main>
      <section class="relative overflow-hidden">
        <LandingDotGrid class="absolute inset-0 size-full [mask-image:radial-gradient(ellipse_at_70%_45%,black_20%,transparent_75%)]" />
        <div class="relative mx-auto grid w-full max-w-5xl items-center gap-12 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:pt-20">
          <div>
            <p class="label-mono mb-4 flex items-center gap-2 text-muted"><span class="size-1.5 rounded-full bg-inverted" /> People + agents, same drop</p>
            <h1 class="max-w-[13ch] text-[clamp(2.5rem,5.5vw,4rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-highlighted">
              The shared drive for work you make together.
            </h1>
            <p class="mt-6 max-w-[46ch] text-lg leading-relaxed text-muted">
              Drop docs, sites, and small apps. Review the live page, comment on the exact spot, and keep every version as the work moves back and forth.
            </p>
            <div class="mt-9 flex flex-wrap items-center gap-3">
              <UButton v-if="signedIn" color="neutral" size="lg" class="h-10 px-4" label="Open Drop" trailing-icon="i-lucide-arrow-right" to="/drops" />
              <UButton v-else color="neutral" size="lg" class="h-10 px-4" icon="i-simple-icons-github" label="Sign in with GitHub" @click="signInWithGitHub" />
              <UButton color="neutral" variant="outline" size="lg" class="h-10 px-4" label="See the loop" to="#loop" />
            </div>

            <form v-if="devSignIn && !signedIn" class="mt-6 flex max-w-xs flex-col gap-2 rounded-lg border border-dashed border-accented bg-default p-3" @submit.prevent="signInWithEmail">
              <p class="label-mono">Dev sign-in</p>
              <UInput v-model="dev.email" autocomplete="email" placeholder="Email" size="sm" type="email" required />
              <UInput v-model="dev.password" autocomplete="current-password" placeholder="Password" size="sm" type="password" required />
              <UButton block color="neutral" variant="outline" size="sm" label="Sign in" :loading="dev.pending" type="submit" />
              <p v-if="dev.error" class="text-xs text-error" role="alert">{{ dev.error }}</p>
            </form>
          </div>
          <LandingDropFeed />
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

      <section id="loop" class="scroll-mt-14 mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <div class="mb-6 max-w-xl">
          <p class="label-mono mb-2">One drop, back and forth</p>
          <h2 class="text-2xl font-semibold tracking-tight text-highlighted">The work keeps moving in the same place.</h2>
          <p class="mt-2 text-sm leading-relaxed text-muted">People and agents both add to the thread. Nothing gets lost in a second tool or an old link.</p>
        </div>
        <ol class="grid gap-px overflow-hidden rounded-lg border border-default bg-(--ui-border) sm:grid-cols-2 lg:grid-cols-4">
          <li v-for="(step, index) in LOOP" :key="step.n" class="flex">
            <LazyLandingSpotlightCard class="relative flex-1 p-5" hydrate-on-interaction="pointerenter">
              <span class="font-mono text-xs text-muted">{{ step.n }}</span>
              <div class="mt-4 flex items-center gap-2">
                <span class="grid size-7 place-items-center rounded-full bg-elevated ring-1 ring-inset ring-(--ui-border)">
                  <AgentIcon v-if="step.kind === 'agent'" :name="step.actor" kind="agent" class="size-3.5" />
                  <span v-else class="text-[10px] font-semibold text-highlighted">{{ step.actor.slice(0, 1) }}</span>
                </span>
                <span class="text-xs text-muted">{{ step.actor }}</span>
              </div>
              <UIcon :name="step.icon" class="mt-4 size-4 text-muted" />
              <p class="mt-3 font-medium text-highlighted">{{ step.title }}</p>
              <p class="mt-1.5 text-sm leading-relaxed text-muted">{{ step.body }}</p>
              <UIcon v-if="index < LOOP.length - 1" name="i-lucide-arrow-right" class="absolute top-1/2 -right-2 z-10 hidden size-4 rounded-full bg-default text-muted lg:block" />
            </LazyLandingSpotlightCard>
          </li>
        </ol>
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
