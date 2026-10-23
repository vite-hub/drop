<script setup lang="ts">
// Signed in, / opens your drops; the landing page stays at /home for everyone. Runs on the server too, so the
// redirect happens before any HTML renders.
definePageMeta({
  alias: "/home",
  middleware: async (to) => {
    if (to.path !== "/") return
    const { data: cached } = useNuxtData(keys.me)
    const me = cached.value ?? (await useMe()).data.value
    if (me) return navigateTo("/drops", { replace: true })
  },
})

const DESCRIPTION =
  "Your agent publishes its plan, page, or app to Drop and sends you a link. You comment on the exact spot, and it publishes the next version."

useSeoMeta({ title: "Review what your agent makes", description: DESCRIPTION })

// What search engines show for the site and the app: its name, that it is a web app, and the questions below.
const origin = useRequestURL().origin
useHead({
  script: [
    {
      type: "application/ld+json",
      innerHTML: JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", name: "Drop", url: `${origin}/` },
          {
            "@type": "WebApplication",
            name: "Drop",
            url: `${origin}/`,
            description: DESCRIPTION,
            applicationCategory: "DeveloperApplication",
            operatingSystem: "Web",
            image: `${origin}/og.png`,
          },
        ],
      }),
    },
  ],
})

const route = useRoute("index")
const { signedIn, signInWithGitHub } = useGitHubSignIn()

// `nuxt dev` has no GitHub app: /?signin=1 shows a small email form instead.
const devSignIn = computed(() => import.meta.dev && route.query.signin === "1")

// Try it now: the one-line setups. Cursor, VS Code, and the chat apps take a file or a form, so they live on /docs/agents.
const SNIPPETS = mcpSnippets(`${origin}/mcp`)
const TRY = (["claude", "codex", "any"] as const).map((value) => ({ value, label: MCP_CLIENTS[value] }))
const client = ref<(typeof TRY)[number]["value"]>("claude")

const AGENTS = ["Claude Code", "Codex", "Cursor", "Copilot", "Gemini CLI", "Windsurf", "Zed", "opencode"]

// The loop, in what you type and what Drop shows back.
const STEPS = [
  {
    title: "Your agent drops it",
    body: "Ask for a plan, a page, or a small app. The agent publishes it to Drop and answers with a link. It starts private.",
    prompt: "write the launch plan and drop it",
  },
  {
    title: "You comment on the spot",
    body: "Open the link full screen. Select a sentence, drag a box over a screenshot, or pin a note on a running site. Share it when the team should see it.",
    prompt: null,
  },
  {
    title: "It drops the next version",
    body: "The agent reads the open comments over MCP and publishes v2. History shows what changed, and unresolved comments carry over.",
    prompt: "fix the comments on the launch plan",
  },
] as const

// What an agent can drop, one row each, like a listing. Each opens its section of the docs.
const KINDS = [
  {
    icon: "i-mingcute-document-2-line",
    name: "Plans and docs",
    detail: "Markdown with tables, Mermaid, and math. Your team can edit it together, live.",
    example: "launch-plan.md",
    to: "/docs/features#edit",
  },
  {
    icon: "i-mingcute-code-line",
    name: "HTML pages",
    detail: "Explainers, reports, and prototypes with their own scripts and styles.",
    example: "pricing-explainer.html",
    to: "/docs/features#apps",
  },
  {
    icon: "i-mingcute-layout-line",
    name: "Small apps",
    detail: "A folder of static files, served on its own origin. The link runs it.",
    example: "launch-board/",
    to: "/docs/features#apps",
  },
  {
    icon: "i-mingcute-git-pull-request-line",
    name: "Pull request evidence",
    detail: "Before and after screenshots with notes, linked from the PR.",
    example: "pr-412-evidence.md",
    to: "/docs/agents#skill",
  },
  {
    icon: "i-mingcute-web-line",
    name: "Live sites",
    detail: "Point a review at a preview deploy. People comment on the page itself.",
    example: "preview.acme.dev",
    to: "/docs/sites",
  },
  {
    icon: "i-mingcute-pen-line",
    name: "Boards",
    detail: "Excalidraw boards for flows and sketches, commented like everything else.",
    example: "checkout-flow.excalidraw",
    to: "/docs/features",
  },
]

const AROUND = [
  {
    icon: "i-mingcute-lock-line",
    text: "Private until you share it: with the team, or by link that allows view, comment, or edit",
  },
  { icon: "i-mingcute-history-line", text: "Every version numbered, with a note and a diff" },
  { icon: "i-mingcute-search-line", text: "⌘K finds a drop by its name or the words inside it" },
  { icon: "i-mingcute-folder-line", text: "Folder descriptions tell agents what goes where and how to write it" },
  {
    icon: "i-mingcute-book-5-line",
    text: "Skills ship with the server, for review, PR evidence, prototypes, and handoffs",
  },
]

const HOSTED = [
  "Sign in with GitHub",
  "Free for you and small teams",
  "Drops expire after inactivity: 30 days for review, 14 for temporary, and never for keep",
]
const SELF_HOSTED = [
  "Team mode: shared inside the team, closed to the internet",
  "Cloudflare, Vercel, Netlify, Deno Deploy, or your own server",
  "Any sign-in Better Auth supports",
]

const FAQ = [
  {
    q: "What is a drop?",
    a: "Anything your agent publishes for people to look at: a Markdown doc, an HTML page, a folder of static files, or a board. Each one gets its own link and keeps every version.",
  },
  {
    q: "Which agents work with it?",
    a: "Any agent that speaks MCP: Claude Code, Codex, Cursor, VS Code, Claude, ChatGPT, and others. The agents page has the setup for each.",
  },
  {
    q: "Do I need an API key?",
    a: "No. The first time your agent connects, Drop opens in your browser and you sign in. The agent keeps its own token.",
  },
  {
    q: "Who can see what my agent drops?",
    a: "Only you, until you share it. Share it with your team, or turn on a public link and pick whether it allows viewing or commenting. Team Drops can also grant editing.",
  },
  {
    q: "How is this different from a gist or a shared drive?",
    a: "People comment on the exact sentence, screenshot region, or spot on a page, and the agent reads those comments and publishes the next version itself. Nobody copies feedback back into a chat.",
  },
  {
    q: "Can I run it myself?",
    a: "Yes. Drop is open source under Apache-2.0. Deploy it to Cloudflare, Vercel, Netlify, Deno Deploy, or a server, and everything stays in your account.",
  },
]
</script>

<template>
  <div class="min-h-dvh bg-default text-default">
    <SiteHeader wide />

    <main>
      <!-- Hero: what it is, the command to try it, and the agents it works with. The pattern skills.sh uses. -->
      <section class="mx-auto max-w-6xl px-4 pt-16 pb-16 sm:px-6 lg:pt-24 lg:pb-20">
        <div class="grid grid-cols-[minmax(0,1fr)] gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-16">
          <div>
            <p class="label-mono">Drop · for Claude Code, Codex, and any MCP agent</p>
            <h1
              class="mt-5 max-w-[14ch] text-[clamp(2.5rem,6vw,4.25rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance text-highlighted"
            >
              Review what your
              <em class="font-serif text-[1.1em] leading-none font-normal tracking-normal italic">agent</em> makes.
            </h1>
            <p class="mt-6 max-w-[52ch] text-lg leading-relaxed text-pretty text-muted">
              Your agent publishes its plan, page, or app to Drop and sends you a link. You and your team comment on the
              exact spot. The agent reads the comments and publishes the next version.
            </p>
            <div class="mt-8 flex flex-wrap items-center gap-3">
              <UButton
                v-if="signedIn"
                color="neutral"
                size="lg"
                class="h-10 px-4"
                label="Open Drop"
                trailing-icon="i-mingcute-arrow-right-line"
                to="/drops"
              />
              <UButton
                v-else
                color="neutral"
                size="lg"
                class="h-10 px-4"
                icon="i-simple-icons-github"
                label="Sign in with GitHub"
                @click="signInWithGitHub"
              />
              <UButton color="neutral" variant="ghost" size="lg" class="h-10 px-4" label="How it works" to="#how" />
            </div>
            <DevSignIn v-if="devSignIn && !signedIn" class="mt-6 max-w-xs" />
          </div>

          <div class="flex flex-col gap-8 lg:pt-10">
            <div>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <h2 class="label-mono text-highlighted">Try it now</h2>
                <UTabs
                  v-model="client"
                  :items="TRY"
                  :content="false"
                  color="neutral"
                  size="xs"
                  :ui="{
                    list: 'w-auto',
                    indicator: 'bg-default shadow-xs ring ring-default',
                    trigger: 'text-xs data-[state=active]:text-highlighted',
                  }"
                />
              </div>
              <AgentsCodeBlock class="mt-3" :code="SNIPPETS[client]" />
              <p class="mt-3 text-sm text-pretty text-muted">
                {{ MCP_HINTS[client] }} Then ask it to drop something for review.
                <NuxtLink
                  to="/docs/agents"
                  class="whitespace-nowrap text-highlighted underline decoration-(--ui-border-accented) underline-offset-4 hover:decoration-(--ui-text-highlighted)"
                  >Cursor, VS Code, ChatGPT</NuxtLink
                >
              </p>
            </div>
            <div>
              <h2 class="label-mono text-highlighted">Works with these agents</h2>
              <ul class="mt-4 flex flex-wrap gap-x-5 gap-y-3">
                <li v-for="name in AGENTS" :key="name" class="flex items-center gap-2 text-sm text-muted">
                  <AgentIcon :name="name" kind="agent" class="size-4" />{{ name }}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- The product itself, the way skills.sh leads with its leaderboard: a real doc with real comments. -->
      <section class="mx-auto max-w-6xl px-4 sm:px-6">
        <figure class="mx-auto max-w-[1066px] overflow-hidden rounded-xl border border-default bg-muted p-2 sm:p-3">
          <div class="overflow-hidden rounded-lg border border-default bg-white shadow-sm">
            <div class="flex items-center gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-2">
              <span class="size-2.5 rounded-full bg-neutral-300" />
              <span class="size-2.5 rounded-full bg-neutral-300" />
              <span class="size-2.5 rounded-full bg-neutral-300" />
              <span class="mx-auto truncate font-mono text-xs text-neutral-500"
                >drop.vitehub.dev/d/k3x9/billing-migration</span
              >
            </div>
            <img
              src="/docs/features/comments.webp"
              width="1040"
              height="760"
              alt="A plan named Billing migration open in Drop, with three open comments pinned to sentences and a reply thread beside the text"
              class="block h-auto w-full"
              fetchpriority="high"
            />
          </div>
          <figcaption class="px-2 pt-3 pb-1 text-sm text-muted">
            A plan Claude Code dropped, with the team's comments on the lines they're about.
          </figcaption>
        </figure>
      </section>

      <section id="how" class="mx-auto max-w-6xl scroll-mt-14 px-4 pt-24 sm:px-6 lg:pt-32">
        <p class="label-mono">How it works</p>
        <h2 class="mt-3 text-3xl font-semibold tracking-tight text-balance text-highlighted">
          Feedback goes to the agent, not into a
          <em class="font-serif text-[1.1em] leading-none font-normal tracking-normal italic">chat</em>.
        </h2>
        <ol class="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
          <li v-for="(step, i) in STEPS" :key="step.title" class="border-t border-default pt-5">
            <p class="flex items-baseline gap-3">
              <span class="font-mono text-sm text-dimmed tabular-nums">0{{ i + 1 }}</span>
              <span class="font-medium text-highlighted">{{ step.title }}</span>
            </p>
            <p class="mt-2 text-sm leading-relaxed text-pretty text-muted">{{ step.body }}</p>
            <p
              v-if="step.prompt"
              class="mt-4 truncate rounded-md border border-default bg-muted px-3 py-2 font-mono text-xs text-highlighted"
            >
              <span class="text-dimmed">›</span> {{ step.prompt }}
            </p>
          </li>
        </ol>
      </section>

      <section class="mx-auto max-w-6xl px-4 pt-24 sm:px-6 lg:pt-32">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p class="label-mono">What it holds</p>
            <h2 class="mt-3 text-3xl font-semibold tracking-tight text-highlighted">What your agent can drop.</h2>
          </div>
          <NuxtLink
            to="/docs/features"
            class="text-sm text-muted underline decoration-(--ui-border-accented) underline-offset-4 hover:text-highlighted"
            >All features</NuxtLink
          >
        </div>
        <ul class="mt-8 border-t border-default">
          <li v-for="(kind, i) in KINDS" :key="kind.name" class="border-b border-default">
            <NuxtLink
              :to="kind.to"
              class="group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-4 outline-none focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted) sm:grid-cols-[2rem_minmax(0,14rem)_minmax(0,1fr)_auto]"
            >
              <span class="font-mono text-sm text-dimmed tabular-nums">{{ i + 1 }}</span>
              <span class="flex items-center gap-2 font-medium text-highlighted">
                <UIcon :name="kind.icon" class="size-4 shrink-0 text-muted" />{{ kind.name }}
              </span>
              <span class="col-start-2 text-sm text-pretty text-muted sm:col-start-auto">{{ kind.detail }}</span>
              <span
                class="col-start-3 row-start-1 hidden items-center gap-2 font-mono text-xs text-dimmed sm:col-start-auto sm:row-start-auto sm:flex"
              >
                {{ kind.example }}
                <UIcon
                  name="i-mingcute-arrow-right-up-line"
                  class="size-3.5 opacity-0 transition-opacity group-hover:opacity-100"
                />
              </span>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section class="mx-auto max-w-6xl px-4 pt-24 sm:px-6 lg:pt-32">
        <div class="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div>
            <p class="label-mono">Around every drop</p>
            <h2 class="mt-3 text-3xl font-semibold tracking-tight text-balance text-highlighted">
              Every version kept, nothing public by accident.
            </h2>
            <ul class="mt-8 space-y-4">
              <li v-for="item in AROUND" :key="item.text" class="flex gap-3 text-sm leading-relaxed text-toned">
                <UIcon :name="item.icon" class="mt-0.5 size-4 shrink-0 text-muted" />{{ item.text }}
              </li>
            </ul>
          </div>
          <div class="overflow-hidden rounded-xl border border-default bg-muted p-2 sm:p-3">
            <img
              src="/docs/features/history.webp"
              width="1040"
              height="470"
              loading="lazy"
              alt="Version 2 of the Billing migration plan beside version 1, with added and removed lines, and the History panel listing both versions"
              class="block h-auto w-full rounded-lg border border-default bg-white"
            />
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 pt-24 sm:px-6 lg:pt-32">
        <h2 class="text-3xl font-semibold tracking-tight text-highlighted">
          Use it here, or
          <em class="font-serif text-[1.1em] leading-none font-normal tracking-normal italic">run your own</em>.
        </h2>
        <div class="mt-10 grid gap-10 md:grid-cols-2 md:gap-8">
          <div class="border-t border-default pt-5">
            <p class="label-mono">drop.vitehub.dev</p>
            <p class="mt-2 text-lg font-medium tracking-tight text-highlighted">Sign in and start dropping.</p>
            <ul class="mt-4 space-y-2 text-sm text-toned">
              <li v-for="item in HOSTED" :key="item" class="flex gap-2">
                <UIcon name="i-mingcute-check-line" class="mt-0.5 size-4 shrink-0 text-muted" />{{ item }}
              </li>
            </ul>
          </div>
          <div class="border-t border-default pt-5">
            <p class="label-mono flex items-center gap-2"><ViteHubMark class="size-3" />Built on ViteHub</p>
            <p class="mt-2 text-lg font-medium tracking-tight text-highlighted">Deploy one for your team.</p>
            <ul class="mt-4 space-y-2 text-sm text-toned">
              <li v-for="item in SELF_HOSTED" :key="item" class="flex gap-2">
                <UIcon name="i-mingcute-check-line" class="mt-0.5 size-4 shrink-0 text-muted" />{{ item }}
              </li>
            </ul>
            <NuxtLink
              to="/docs/self-host"
              class="mt-4 inline-block text-sm text-highlighted underline decoration-(--ui-border-accented) underline-offset-4 hover:decoration-(--ui-text-highlighted)"
              >Self-hosting guide</NuxtLink
            >
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 pt-24 sm:px-6 lg:pt-32">
        <div class="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <h2 class="text-3xl font-semibold tracking-tight text-highlighted">Questions</h2>
          <div class="border-t border-default">
            <details v-for="item in FAQ" :key="item.q" class="group border-b border-default">
              <summary
                class="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium text-highlighted outline-none focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted) [&::-webkit-details-marker]:hidden"
              >
                {{ item.q }}
                <UIcon
                  name="i-mingcute-add-line"
                  class="size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-45"
                />
              </summary>
              <p class="max-w-[60ch] pb-5 text-sm leading-relaxed text-pretty text-muted">{{ item.a }}</p>
            </details>
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 pt-24 pb-24 sm:px-6 lg:pt-32 lg:pb-32">
        <div
          class="flex flex-col items-start justify-between gap-6 rounded-xl border border-default p-8 sm:flex-row sm:items-center"
        >
          <div>
            <p class="text-xl font-semibold tracking-tight text-highlighted">
              Drop your
              <em class="font-serif text-[1.1em] leading-none font-normal tracking-normal italic">first</em> doc.
            </p>
            <p class="mt-1 text-sm text-muted">
              Sign in with GitHub, connect your agent, and ask it to drop something for review.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              label="Read the source"
              to="https://github.com/vite-hub/drop"
              target="_blank"
            />
            <UButton v-if="signedIn" color="neutral" label="Open Drop" to="/drops" />
            <UButton
              v-else
              color="neutral"
              icon="i-simple-icons-github"
              label="Sign in with GitHub"
              @click="signInWithGitHub"
            />
          </div>
        </div>
      </section>
    </main>

    <SiteFooter wide />
  </div>
</template>
