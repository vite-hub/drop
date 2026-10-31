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

// The loop, in what you type and what Drop shows back. The middle step is people: everyone you share it with.
const STEPS = [
  {
    title: "Your agent drops it",
    body: "A plan, a page, or an app, as a link your team can open.",
    prompt: "write the launch plan and drop it",
  },
  {
    title: "Your team comments on the spot",
    body: "Anyone you share it with selects a sentence, boxes a screenshot, or pins a site.",
    prompt: null,
  },
  {
    title: "It drops the next version",
    body: "It reads everyone's comments and publishes v2.",
    prompt: "fix the comments on the launch plan",
  },
] as const

// Who commented in step 2, as initials on a tint.
const PEOPLE = [
  { initials: "AL", tint: "bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-200" },
  { initials: "MR", tint: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200" },
  { initials: "You", tint: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200" },
]

const AROUND = [
  { icon: "i-mingcute-lock-line", text: "Private until you share it" },
  { icon: "i-mingcute-history-line", text: "Every version with a note and a diff" },
  { icon: "i-mingcute-search-line", text: "⌘K searches names and contents" },
  { icon: "i-mingcute-folder-line", text: "Folders tell agents where things go" },
  { icon: "i-mingcute-book-5-line", text: "Skills for review, PR evidence, and handoffs" },
]

const HOSTED = ["Sign in with GitHub", "Free for one or two people", "Drops nobody opens expire, unless you keep them"]
const SELF_HOSTED = [
  "Team mode: open to the team, closed to the internet",
  "Cloudflare, Vercel, Netlify, Deno Deploy, or your own server",
  "Any sign-in Better Auth supports",
  "Free for one or two people, $9 per member a month from 3",
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
    a: "Yes. Deploy it to Cloudflare, Vercel, Netlify, Deno Deploy, or a server, and everything stays in your account. It's free for one or two people; a team of 3 or more pays $9 per member a month.",
  },
]
</script>

<template>
  <div class="min-h-dvh bg-default text-default">
    <SiteHeader wide />

    <main>
      <!-- Hero: what it is on the left, the command to try it on the right, with the agents as the picker. -->
      <div class="relative isolate">
        <LandingShader
          class="absolute inset-x-0 top-0 -z-10 h-[72rem] w-full [mask-image:radial-gradient(ellipse_70%_45%_at_50%_72%,black_30%,transparent)]"
        />
        <section
          class="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-12 px-4 pt-16 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14 lg:pt-24 lg:pb-20"
        >
          <div>
            <h1
              class="max-w-[16ch] text-[clamp(2.5rem,5.5vw,3.75rem)] leading-[1.1] font-semibold tracking-[-0.045em] text-balance text-highlighted"
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
            <p class="mt-6 max-w-[42ch] text-lg leading-relaxed text-pretty text-muted">
              Your agent drops a link. Your team comments on the exact spot. It publishes the next version.
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
              <UButton color="neutral" variant="outline" size="lg" class="h-10 px-4" label="How it works" to="#how" />
            </div>
            <DevSignIn v-if="devSignIn && !signedIn" class="mt-6 w-full max-w-xs" />
          </div>

          <LandingSetup />
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
          Your team's feedback goes to the agent, not into a chat.
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
            <div class="mt-auto pt-4">
              <p
                v-if="step.prompt"
                class="truncate rounded-md border border-default bg-muted px-3 py-2 font-mono text-xs text-highlighted"
              >
                <span class="text-dimmed">›</span> {{ step.prompt }}
              </p>
              <p v-else class="flex items-center gap-2.5 py-1 text-xs text-muted">
                <span class="flex -space-x-1">
                  <span
                    v-for="person in PEOPLE"
                    :key="person.initials"
                    class="grid size-6 place-items-center rounded-full text-[9px] font-semibold ring-2 ring-(--ui-bg)"
                    :class="person.tint"
                    >{{ person.initials }}</span
                  >
                </span>
                Ana, Marco, and you · 5 comments
              </p>
            </div>
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
        <LandingKinds class="mt-8" />
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
          <LandingHistory />
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
            <p class="mt-4 flex gap-5 text-sm">
              <NuxtLink
                to="/docs/self-host"
                class="text-highlighted underline decoration-(--ui-border-accented) underline-offset-4 hover:decoration-(--ui-text-highlighted)"
                >Self-hosting guide</NuxtLink
              >
              <NuxtLink
                to="/pricing"
                class="text-highlighted underline decoration-(--ui-border-accented) underline-offset-4 hover:decoration-(--ui-text-highlighted)"
                >Pricing</NuxtLink
              >
            </p>
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
