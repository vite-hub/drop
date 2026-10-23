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
    body: "A plan, a page, or an app, as a private link.",
    prompt: "write the launch plan and drop it",
  },
  {
    title: "You comment on the spot",
    body: "Select a sentence, box a screenshot, or pin a site.",
    prompt: null,
  },
  {
    title: "It drops the next version",
    body: "It reads your comments and publishes v2.",
    prompt: "fix the comments on the launch plan",
  },
] as const

// What an agent can drop, one row each, like a listing. Each opens its section of the docs.
const KINDS = [
  {
    icon: "i-mingcute-document-2-line",
    name: "Plans and docs",
    detail: "Markdown with tables, Mermaid, and math. Edit it together, live.",
    example: "launch-plan.md",
    to: "/docs/features#edit",
    wide: true,
  },
  {
    icon: "i-mingcute-code-line",
    name: "HTML pages",
    detail: "Explainers and reports with their own scripts.",
    example: "pricing-explainer.html",
    to: "/docs/features#apps",
  },
  {
    icon: "i-mingcute-layout-line",
    name: "Small apps",
    detail: "A folder of static files. The link runs it.",
    example: "launch-board/",
    to: "/docs/features#apps",
  },
  {
    icon: "i-mingcute-git-pull-request-line",
    name: "Pull request evidence",
    detail: "Before and after screenshots, linked from the PR.",
    example: "pr-412-evidence.md",
    to: "/docs/agents#skill",
  },
  {
    icon: "i-mingcute-web-line",
    name: "Live sites",
    detail: "Comment on a preview deploy itself.",
    example: "preview.acme.dev",
    to: "/docs/sites",
  },
  {
    icon: "i-mingcute-pen-line",
    name: "Boards",
    detail: "Excalidraw boards for flows and sketches, commented like everything else.",
    example: "checkout-flow.excalidraw",
    to: "/docs/features",
    wide: true,
  },
]

const AROUND = [
  { icon: "i-mingcute-lock-line", text: "Private until you share it" },
  { icon: "i-mingcute-history-line", text: "Every version with a note and a diff" },
  { icon: "i-mingcute-search-line", text: "⌘K searches names and contents" },
  { icon: "i-mingcute-folder-line", text: "Folders tell agents where things go" },
  { icon: "i-mingcute-book-5-line", text: "Skills for review, PR evidence, and handoffs" },
]

const HOSTED = [
  "Sign in with GitHub",
  "Free for you and small teams",
  "Drops nobody opens expire, unless you keep them",
]
const SELF_HOSTED = [
  "Team mode: open to the team, closed to the internet",
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
      <div class="relative isolate">
        <LandingShader
          class="absolute inset-x-0 top-0 -z-10 h-[64rem] w-full [mask-image:radial-gradient(ellipse_75%_55%_at_50%_68%,black_35%,transparent)]"
        />
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
                Your agent drops a link. You comment on the exact spot. It publishes the next version.
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
                  {{ MCP_HINTS[client] }}
                  <NuxtLink
                    to="/docs/agents"
                    class="whitespace-nowrap text-highlighted underline decoration-(--ui-border-accented) underline-offset-4 hover:decoration-(--ui-text-highlighted)"
                    >Other agents</NuxtLink
                  >
                </p>
              </div>
              <div>
                <h2 class="sr-only">Works with</h2>
                <ul class="flex flex-wrap items-center gap-x-6 gap-y-4">
                  <li v-for="name in AGENTS" :key="name">
                    <UTooltip :text="name">
                      <AgentIcon
                        :name="name"
                        kind="agent"
                        :aria-label="name"
                        role="img"
                        class="size-6 opacity-60 grayscale transition hover:opacity-100 hover:grayscale-0"
                      />
                    </UTooltip>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <!-- The loop itself, played out: Claude Code drops a plan, you comment on a line, it publishes v2. -->
        <section class="mx-auto max-w-6xl px-4 sm:px-6">
          <figure>
            <LandingLoopStory />
            <figcaption class="sr-only">
              Claude Code drops a launch plan linked to its pull request. You comment on one line, and Claude Code reads
              the comment and publishes version 2 with the fix.
            </figcaption>
          </figure>
        </section>
      </div>

      <section id="how" class="mx-auto max-w-6xl scroll-mt-14 px-4 pt-24 sm:px-6 lg:pt-32">
        <p class="label-mono">How it works</p>
        <h2 class="mt-3 text-3xl font-semibold tracking-tight text-balance text-highlighted">
          Feedback goes to the agent, not into a
          <em class="font-serif text-[1.1em] leading-none font-normal tracking-normal italic">chat</em>.
        </h2>
        <ol class="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
          <li v-for="(step, i) in STEPS" :key="step.title">
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
        <ul class="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <li v-for="kind in KINDS" :key="kind.name" :class="kind.wide && 'lg:col-span-2'">
            <NuxtLink
              :to="kind.to"
              class="group flex h-full min-h-40 flex-col rounded-xl bg-muted p-5 outline-none transition-colors hover:bg-elevated focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted)"
            >
              <span class="flex items-center justify-between">
                <UIcon :name="kind.icon" class="size-5 text-highlighted" />
                <UIcon
                  name="i-mingcute-arrow-right-up-line"
                  class="size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100"
                />
              </span>
              <span class="mt-auto pt-6 font-medium text-highlighted">{{ kind.name }}</span>
              <span class="mt-1 text-sm text-pretty text-muted">{{ kind.detail }}</span>
              <span class="mt-3 font-mono text-xs text-dimmed">{{ kind.example }}</span>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section class="mx-auto max-w-6xl px-4 pt-24 sm:px-6 lg:pt-32">
        <div class="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div>
            <h2 class="text-3xl font-semibold tracking-tight text-balance text-highlighted">Around every drop</h2>
            <ul class="mt-8 space-y-4">
              <li v-for="item in AROUND" :key="item.text" class="flex gap-3 text-sm leading-relaxed text-toned">
                <UIcon :name="item.icon" class="mt-0.5 size-4 shrink-0 text-muted" />{{ item.text }}
              </li>
            </ul>
          </div>
          <img
            src="/docs/features/history.webp"
            width="1040"
            height="470"
            loading="lazy"
            alt="Version 2 of the Billing migration plan beside version 1, with added and removed lines, and the History panel listing both versions"
            class="block h-auto w-full rounded-xl border border-default bg-white shadow-xl shadow-black/5"
          />
        </div>
      </section>

      <section class="mx-auto max-w-6xl px-4 pt-24 sm:px-6 lg:pt-32">
        <h2 class="text-3xl font-semibold tracking-tight text-highlighted">
          Use it here, or
          <em class="font-serif text-[1.1em] leading-none font-normal tracking-normal italic">run your own</em>.
        </h2>
        <div class="mt-10 grid gap-10 md:grid-cols-2 md:gap-8">
          <div>
            <p class="label-mono">drop.vitehub.dev</p>
            <p class="mt-2 text-lg font-medium tracking-tight text-highlighted">Sign in and start dropping.</p>
            <ul class="mt-4 space-y-2 text-sm text-toned">
              <li v-for="item in HOSTED" :key="item" class="flex gap-2">
                <UIcon name="i-mingcute-check-line" class="mt-0.5 size-4 shrink-0 text-muted" />{{ item }}
              </li>
            </ul>
          </div>
          <div>
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
          <div class="-mt-4 divide-y divide-default">
            <details v-for="item in FAQ" :key="item.q" class="group">
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
