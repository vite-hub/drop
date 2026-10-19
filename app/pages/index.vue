<script setup lang="ts">
import { ROLE_LABELS } from "#shared/roles"

// Signed in, / opens your drops; the landing page stays at /home for everyone. Runs on the server too, so the
// redirect happens before any HTML renders.
definePageMeta({
  alias: "/home",
  middleware: async (to) => {
    if (to.path !== "/") return
    const { data: cached } = useNuxtData("me")
    const me = cached.value ?? (await useMe()).data.value
    if (me) return navigateTo("/drops", { replace: true })
  },
})

useSeoMeta({
  title: "The shared drive for people and their agents",
  description: "Agents drop docs, pages, and small apps. People comment on the exact spot, and the agent drops the next version.",
})

// What search engines show for the site and the app: its name, and that it is a web app.
const origin = useRequestURL().origin
useHead({
  script: [{
    type: "application/ld+json",
    innerHTML: JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", "name": "Drop", "url": `${origin}/` },
        {
          "@type": "WebApplication",
          "name": "Drop",
          "url": `${origin}/`,
          "description": "The shared drive for people and their agents. Agents drop docs, pages, and small apps; people comment on the exact spot, and the agent drops the next version.",
          "applicationCategory": "DeveloperApplication",
          "operatingSystem": "Web",
          "image": `${origin}/og.png`,
        },
      ],
    }),
  }],
})

const route = useRoute()
const { signedIn, signInWithGitHub } = useGitHubSignIn()

// `nuxt dev` has no GitHub app: /?signin=1 shows a small email form instead.
const devSignIn = computed(() => import.meta.dev && route.query.signin === "1")

const AGENTS = ["Claude Code", "Codex", "Cursor", "Copilot", "Gemini CLI", "Windsurf", "Zed", "opencode"]

// The first card is the point of Drop, so it gets two columns.
const FEATURES = [
  { icon: "i-ph-sparkle", title: "Agents make the changes", body: "People comment. The agent reads the open comments over MCP and drops the next version, so nobody copies feedback into a chat by hand." },
  { icon: "i-ph-stack", title: "Docs and apps", body: "Markdown, HTML with scripts, Mermaid, or a folder of static files. Each opens full screen at its own link." },
  { icon: "i-ph-chat-circle", title: "Comments on the exact spot", body: "Select a sentence or zoom into a screenshot and pin it. Copy everything back as Markdown." },
  { icon: "i-ph-lock", title: "Private until shared", body: "One switch makes a link. Pick what it allows: view, comment, or edit." },
  { icon: "i-ph-users", title: "Edit together", body: "Change a Markdown doc with others, live, in a Notion-like editor. Publish makes it the next version." },
  { icon: "i-ph-plug", title: "MCP built in", body: "Add one URL to your agent and sign in through the browser. No API keys. The Drop skill comes with it." },
  { icon: "i-ph-clock-counter-clockwise", title: "Older versions one click back", body: "Each new version of a doc gets a number. Drops nobody opens for 30 days expire unless you keep them." },
]

const USE_CASES = [
  {
    story: "pr",
    label: "Pull requests",
    title: ["Put the before and after in every ", "pull request", "."],
    body: "Claude Code drops the screenshots with its notes and links them from the PR. Reviewers see what changed, then read the diff.",
  },
  {
    story: "app",
    label: "Vibe-coded apps",
    title: ["Ship the thing you ", "just made", "."],
    body: "Ask for a prototype, a tool, or a small game. Your agent publishes the folder and the link runs it. This one's real, so try it.",
  },
] as const

const SELF_HOSTED = [
  "Team mode: shared inside the team, closed to the internet",
  "Deploy to Cloudflare, Vercel, Netlify, Deno Deploy, or your own server",
  "Any sign-in Better Auth supports",
]
// The members in the self-hosted card's picture, as they'd show on the Members page.
const TEAM = [{ name: "You", role: "admin" }, { name: "Ben", role: "member" }, { name: "Lea", role: "member" }] as const

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
              <span class="rounded-full bg-elevated px-2 py-0.5 font-mono text-[11px] tracking-wide text-highlighted uppercase">MCP</span>
              Connect Claude Code, Codex, or any agent
              <UIcon name="i-ph-arrow-right" class="size-3" />
            </NuxtLink>
            <h1 class="max-w-[18ch] text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-highlighted">
              The shared drive for people and <em class="font-serif text-[1.1em] leading-none font-normal tracking-normal italic">their agents</em>.
            </h1>
            <p class="mt-6 max-w-[56ch] text-lg leading-relaxed text-pretty text-muted">
              <LandingMention name="Claude Code" icon="i-simple-icons-claude" color="#D97757" href="https://claude.com/claude-code" />, <LandingMention name="Codex" icon="i-simple-icons-openai" href="https://openai.com/codex" />, or any <LandingMention name="MCP" icon="i-simple-icons-modelcontextprotocol" href="https://modelcontextprotocol.io" /> agent drops a doc, a page, or a small app. You comment on the exact spot, and the agent drops the next version.
            </p>
            <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
              <UButton v-if="signedIn" color="neutral" size="lg" class="h-10 px-4" label="Open Drop" trailing-icon="i-ph-arrow-right" to="/drops" />
              <UButton v-else color="neutral" size="lg" class="h-10 px-4" icon="i-simple-icons-github" label="Sign in with GitHub" @click="signInWithGitHub" />
              <UButton color="neutral" variant="outline" size="lg" class="h-10 px-4" label="Read the docs" to="/docs" />
            </div>

            <DevSignIn v-if="devSignIn && !signedIn" class="mt-6 max-w-xs" />
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
            <h2 class="text-3xl leading-tight font-semibold tracking-tight text-balance text-highlighted">{{ useCase.title[0] }}<em class="font-serif text-[1.1em] leading-none font-normal tracking-normal italic">{{ useCase.title[1] }}</em>{{ useCase.title[2] }}</h2>
          </div>
          <p class="max-w-[52ch] leading-relaxed text-pretty text-muted">{{ useCase.body }}</p>
        </div>
        <div class="rounded-xl border border-default bg-muted p-3 sm:p-8 lg:p-10">
          <LazyLandingPrStory v-if="useCase.story === 'pr'" hydrate-on-visible />
          <LazyLandingAppStory v-else hydrate-on-visible />
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 py-24 sm:px-6 lg:py-32">
        <div class="mb-10 lg:mb-12">
          <p class="label-mono mb-3">A live page for every file</p>
          <h2 class="text-3xl font-semibold tracking-tight text-highlighted">What every <em class="font-serif text-[1.1em] leading-none font-normal tracking-normal italic">drop</em> gets.</h2>
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
        <h2 class="mb-10 text-3xl font-semibold tracking-tight text-highlighted lg:mb-12">Use it here, or <em class="font-serif text-[1.1em] leading-none font-normal tracking-normal italic">run your own</em>.</h2>
        <!-- Each card leads with a small picture of the product: a private drop with its share switch, and a team with
             one member per role. Flat tokens only, like the stories above. -->
        <div class="grid gap-4 md:grid-cols-2">
          <div class="flex flex-col rounded-xl border border-default bg-default p-2">
            <div aria-hidden="true" class="relative grid h-44 place-items-center overflow-hidden rounded-lg border border-default bg-muted">
              <div class="w-64 rounded-lg border border-default bg-default shadow-sm">
                <div class="flex items-center gap-2 border-b border-default px-3 py-2">
                  <UIcon name="i-ph-file-text" class="size-3.5 text-muted" />
                  <span class="font-mono text-xs text-toned">launch-plan.md</span>
                  <span class="ml-auto inline-flex items-center gap-1 rounded-sm border border-default px-1.5 text-xs text-muted"><UIcon name="i-ph-lock-simple" class="size-3" />Private</span>
                </div>
                <div class="space-y-2 px-3 py-3">
                  <div class="h-1.5 w-3/4 rounded-full bg-accented" />
                  <div class="h-1.5 w-full rounded-full bg-accented/70" />
                  <div class="h-1.5 w-1/2 rounded-full bg-accented/70" />
                </div>
              </div>
              <div class="absolute right-6 bottom-5 flex items-center gap-1.5 rounded-md border border-default bg-default px-2 py-1 text-xs text-toned shadow-md">
                <UIcon name="i-ph-globe-simple" class="size-3.5" />Anyone with the link
              </div>
            </div>
            <div class="flex-1 px-4 pt-5 pb-4">
              <p class="label-mono">drop.vitehub.dev</p>
              <p class="mt-2 text-lg font-medium tracking-tight text-highlighted">Sign in and start dropping.</p>
              <p class="mt-1.5 text-sm leading-relaxed text-muted">Drops start private. A link shares one only when you say so.</p>
              <ul class="mt-4 space-y-2 text-sm">
                <li v-for="item in HOSTED" :key="item" class="flex gap-2">
                  <UIcon name="i-ph-check" class="mt-0.5 size-4 shrink-0 text-muted" />{{ item }}
                </li>
              </ul>
            </div>
          </div>
          <div class="flex flex-col rounded-xl border border-default bg-default p-2">
            <div aria-hidden="true" class="grid h-44 place-items-center overflow-hidden rounded-lg border border-default bg-muted">
              <ul class="w-64 divide-y divide-default rounded-lg border border-default bg-default shadow-sm">
                <li v-for="person in TEAM" :key="person.name" class="flex items-center gap-2.5 px-3 py-2">
                  <span class="grid size-6 place-items-center rounded-full bg-accented text-xs font-medium text-highlighted">{{ person.name[0] }}</span>
                  <span class="text-sm text-highlighted">{{ person.name }}</span>
                  <span class="ml-auto rounded-sm border border-default px-1.5 text-xs" :class="person.role === 'admin' ? 'bg-inverted text-inverted' : 'text-muted'">{{ ROLE_LABELS[person.role] }}</span>
                </li>
              </ul>
            </div>
            <div class="flex-1 px-4 pt-5 pb-4">
              <p class="label-mono">Your own</p>
              <p class="mt-2 text-lg font-medium tracking-tight text-highlighted">Deploy one for your team.</p>
              <p class="mt-1.5 text-sm leading-relaxed text-muted">What anyone drops is the team's, filed in folders your admins describe for people and agents. Public links close after a week.</p>
              <ul class="mt-4 space-y-2 text-sm">
                <li v-for="item in SELF_HOSTED" :key="item" class="flex gap-2">
                  <UIcon name="i-ph-check" class="mt-0.5 size-4 shrink-0 text-muted" />{{ item }}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 pt-24 pb-24 sm:px-6 lg:pt-32 lg:pb-32">
        <div class="flex flex-col items-start justify-between gap-6 rounded-xl border border-default p-8 sm:flex-row sm:items-center">
          <div>
            <p class="text-xl font-semibold tracking-tight text-highlighted">Drop your <em class="font-serif text-[1.1em] leading-none font-normal tracking-normal italic">first</em> doc.</p>
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
