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

// Try it now: the agents are the picker. The selected one shows its name and its color, the others their name on hover.
const SNIPPETS = mcpSnippets(`${origin}/mcp`)
const TRY = [
  { value: "claude", icon: "i-simple-icons-claude", color: "#D97757" },
  { value: "codex", icon: "i-simple-icons-openai" },
  { value: "cursor", icon: "i-simple-icons-cursor" },
  { value: "vscode", icon: "i-simple-icons-visualstudiocode", color: "#0098FF" },
  { value: "claudeai", icon: "i-simple-icons-anthropic" },
  { value: "chatgpt", icon: "i-mingcute-openai-line" },
  {
    value: "any",
    icon: "i-simple-icons-modelcontextprotocol",
    tip: "Any MCP client: Copilot, Gemini CLI, Zed, opencode…",
  },
] as const satisfies readonly { value: McpClient; icon: string; color?: string; tip?: string }[]
const client = ref<McpClient>("claude")

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
      <!-- Hero: what it is and the command to try it, with the agents as the picker. -->
      <div class="relative isolate">
        <LandingShader
          class="absolute inset-x-0 top-0 -z-10 h-[72rem] w-full [mask-image:radial-gradient(ellipse_70%_45%_at_50%_72%,black_30%,transparent)]"
        />
        <section class="mx-auto flex max-w-6xl flex-col items-center px-4 pt-20 pb-16 text-center sm:px-6 lg:pt-28">
          <h1
            class="max-w-[15ch] text-[clamp(2.5rem,6.5vw,4.5rem)] leading-[1.1] font-semibold tracking-[-0.045em] text-balance text-highlighted"
          >
            Review what your
            <!-- The word looks the way a commented sentence looks in Drop: highlighted, with its pin. -->
            <span class="relative whitespace-nowrap"
              ><span class="inline-block rounded-lg bg-amber-200/70 px-1.5 pb-1 leading-[0.95] dark:bg-amber-400/25"
                >agent</span
              ><span
                class="absolute -top-1 -right-2.5 grid size-5 place-items-center rounded-full bg-inverted text-[11px] font-semibold tracking-normal text-inverted shadow-sm"
                aria-hidden="true"
                >1</span
              ></span
            >
            makes.
          </h1>
          <p class="mt-6 max-w-[56ch] text-lg leading-relaxed text-balance text-muted">
            Your agent drops a link. You comment on the exact spot. It publishes the next version.
          </p>
          <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
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
            <UButton color="neutral" variant="outline" size="lg" class="h-10 px-4" label="How it works" to="#how" />
          </div>
          <DevSignIn v-if="devSignIn && !signedIn" class="mt-6 w-full max-w-xs text-left" />

          <div class="mt-12 w-full max-w-xl rounded-xl border border-default bg-default p-1.5 text-left shadow-xs">
            <div class="flex items-center justify-between gap-3 p-1">
              <h2 class="sr-only">Try it now</h2>
              <div role="group" aria-label="Your agent" class="flex flex-wrap items-center gap-0.5">
                <UTooltip
                  v-for="item in TRY"
                  :key="item.value"
                  :text="'tip' in item ? item.tip : MCP_CLIENTS[item.value]"
                  :disabled="client === item.value && !('tip' in item)"
                >
                  <button
                    type="button"
                    :aria-pressed="client === item.value"
                    :aria-label="MCP_CLIENTS[item.value]"
                    class="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted)"
                    :class="
                      client === item.value
                        ? 'bg-elevated font-medium text-highlighted'
                        : 'text-dimmed hover:bg-muted hover:text-highlighted'
                    "
                    @click="client = item.value"
                  >
                    <UIcon
                      :name="item.icon"
                      class="size-4 shrink-0"
                      :style="client === item.value && 'color' in item ? { color: item.color } : undefined"
                    />
                    <span v-if="client === item.value">{{ MCP_CLIENTS[item.value] }}</span>
                  </button>
                </UTooltip>
              </div>
              <NuxtLink to="/docs/agents" class="shrink-0 text-xs text-muted hover:text-highlighted"
                >All setups</NuxtLink
              >
            </div>
            <AgentsCodeBlock class="mt-1" :code="SNIPPETS[client]" />
            <p class="px-2 pt-2 pb-1 text-xs text-pretty text-muted">{{ MCP_HINTS[client] }}</p>
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
        <h2 class="text-3xl font-semibold tracking-tight text-balance text-highlighted">
          Feedback goes to the agent, not into a chat.
        </h2>
        <ol class="mt-10 grid gap-3 md:grid-cols-3">
          <li
            v-for="(step, i) in STEPS"
            :key="step.title"
            class="flex flex-col rounded-xl border border-default bg-default p-5 shadow-xs"
          >
            <span
              class="grid size-6 place-items-center rounded-full bg-elevated font-mono text-xs text-highlighted tabular-nums"
              >{{ i + 1 }}</span
            >
            <p class="mt-4 font-medium text-highlighted">{{ step.title }}</p>
            <p class="mt-1 text-sm leading-relaxed text-pretty text-muted">{{ step.body }}</p>
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
            <h2 class="text-3xl font-semibold tracking-tight text-highlighted">What your agent can drop.</h2>
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
              class="group flex h-full min-h-40 flex-col rounded-xl border border-default bg-default p-5 shadow-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-(--ui-border-inverted)"
            >
              <span class="flex items-center justify-between">
                <span
                  class="grid size-9 place-items-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"
                  ><UIcon :name="kind.icon" class="size-5"
                /></span>
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
        <h2 class="text-3xl font-semibold tracking-tight text-highlighted">Use it here, or run your own.</h2>
        <div class="mt-10 grid gap-10 md:grid-cols-2 md:gap-8">
          <div>
            <p class="flex items-center gap-2 text-sm text-muted"><DropMark class="h-3" />drop.vitehub.dev</p>
            <p class="mt-2 text-lg font-medium tracking-tight text-highlighted">Sign in and start dropping.</p>
            <ul class="mt-4 space-y-2 text-sm text-toned">
              <li v-for="item in HOSTED" :key="item" class="flex gap-2">
                <UIcon name="i-mingcute-check-line" class="mt-0.5 size-4 shrink-0 text-muted" />{{ item }}
              </li>
            </ul>
          </div>
          <div>
            <p class="flex items-center gap-2 text-sm text-muted"><ViteHubMark class="size-3" />Built on ViteHub</p>
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
            <p class="text-xl font-semibold tracking-tight text-highlighted">Drop your first doc.</p>
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
