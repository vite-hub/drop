<script setup lang="ts">
import { ROLE_LABELS, ROLE_SUMMARY, ROLES } from "#shared/roles"

useSeoMeta({ title: "Drop", description: "Review what your agents plan." })

const route = useRoute()
const toast = useToast()
const colorMode = useColorMode()
const { loggedIn, signIn } = useUserSession()

// The session loads client-side; gate on mount so the server and first client render agree.
const mounted = useMounted()
const signedIn = computed(() => mounted.value && loggedIn.value)

const dark = computed(() => colorMode.value === "dark")
const toggleTheme = () => (colorMode.preference = dark.value ? "light" : "dark")

// Back to where the auth guard sent you from; only same-site paths, never a full URL.
const next = computed(() => (typeof route.query.redirect === "string" && route.query.redirect.startsWith("/") && !route.query.redirect.startsWith("//") ? route.query.redirect : "/drops"))

async function signInWithGitHub() {
  const { error } = await signIn.social({ provider: "github", callbackURL: next.value })
  if (error) toast.add({ title: error.message ?? "Couldn't start GitHub sign-in.", color: "error" })
}

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

const STEPS = [
  { n: "01", title: "Connect your agent", body: "One command adds Drop's MCP server. Or hand it an API key, or let it ask for access with Agent Auth.", snippet: "claude mcp add drop …/mcp" },
  { n: "02", title: "It drops its work", body: "A plan, a spec, a report, or a small app with its own files. Every drop starts private, with a link.", snippet: "create_doc · publish_app" },
  { n: "03", title: "You review, it revises", body: "Comment on text or a spot in an image. The agent reads open comments and drops the next version.", snippet: "list_comments" },
]

const FEATURES = [
  { icon: "i-lucide-layers", title: "Docs and apps", body: "Markdown, HTML with scripts, Mermaid, or a folder of static files. All full screen, all versioned." },
  { icon: "i-lucide-message-circle", title: "Comments on the exact spot", body: "Select a sentence or zoom into a screenshot and pin it. Copy everything back as Markdown." },
  { icon: "i-lucide-lock", title: "Private until shared", body: "One switch makes a link. Pick what it allows: view, comment, or edit." },
  { icon: "i-lucide-pencil", title: "Edit in place", body: "A Notion-like editor for docs and a code view for apps, right where you review." },
  { icon: "i-lucide-plug", title: "MCP built in", body: "Streamable HTTP on the latest spec. Five tools, one API key, no SDK." },
  { icon: "i-lucide-history", title: "Every version kept", body: "Agents drop the next version of a doc or app. Older ones stay one click away." },
]

const PERSONAL = ["One deploy to Cloudflare", "You're the admin", "Private by default"]
</script>

<template>
  <div class="min-h-dvh bg-default text-default">
    <header class="sticky top-0 z-30 border-b border-default bg-default">
      <div class="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:gap-4 sm:px-6">
        <div class="flex items-center gap-2.5">
          <NuxtLink class="flex items-center gap-2 font-semibold tracking-tight text-highlighted" to="/">
            <DropMark class="h-5 w-7" />
            <span>Drop</span>
          </NuxtLink>
          <span aria-hidden="true" class="text-lg font-light text-(--ui-border-accented)">/</span>
          <a aria-label="ViteHub" class="flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-highlighted" href="https://vitehub.dev" rel="noreferrer" target="_blank">
            <ViteHubMark class="size-3.5" /><span class="hidden sm:inline">ViteHub</span>
          </a>
        </div>
        <div class="ml-auto flex items-center gap-1">
          <ClientOnly>
            <UButton
              color="neutral"
              variant="ghost"
              :icon="dark ? 'i-lucide-sun' : 'i-lucide-moon'"
              :aria-label="dark ? 'Switch to light theme' : 'Switch to dark theme'"
              @click="toggleTheme"
            />
            <template #fallback><span class="size-8" /></template>
          </ClientOnly>
          <LandingGitHubStars />
          <UButton v-if="signedIn" class="ml-1" color="neutral" variant="outline" label="Open Drop" to="/drops" />
          <UButton v-else class="ml-1" color="neutral" variant="outline" label="Sign In" @click="signInWithGitHub" />
        </div>
      </div>
    </header>

    <main>
      <section class="relative overflow-hidden">
        <LandingDotGrid class="absolute inset-0 size-full [mask-image:radial-gradient(ellipse_at_70%_45%,black_20%,transparent_75%)]" />
        <div class="relative mx-auto grid w-full max-w-5xl items-center gap-12 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:pt-20">
          <div>
            <h1 class="text-[clamp(2.5rem,5.5vw,4rem)] leading-[1.02] font-semibold tracking-[-0.045em] text-highlighted">
              Review what your agents <LandingRotatingText :words="['plan.', 'build.', 'write.', 'ship.']" />
            </h1>
            <p class="mt-6 max-w-[46ch] text-lg leading-relaxed text-muted">
              Agents drop docs and small apps. You comment on the exact spot, share the ones worth sharing, and send the feedback back.
            </p>
            <div class="mt-9 flex flex-wrap items-center gap-3">
              <UButton v-if="signedIn" color="neutral" size="lg" class="h-10 px-4" label="Open Drop" trailing-icon="i-lucide-arrow-right" to="/drops" />
              <UButton v-else color="neutral" size="lg" class="h-10 px-4" icon="i-simple-icons-github" label="Sign in with GitHub" @click="signInWithGitHub" />
              <UButton color="neutral" variant="outline" size="lg" class="h-10 px-4" label="Deploy your own" to="#own" />
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

      <section class="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <h2 class="mb-6 text-2xl font-semibold tracking-tight text-highlighted">How it works</h2>
        <ol class="grid gap-px overflow-hidden rounded-lg border border-default bg-(--ui-border) md:grid-cols-3">
          <li v-for="step in STEPS" :key="step.n" class="flex">
            <LazyLandingSpotlightCard class="flex-1 p-6" hydrate-on-interaction="pointerenter">
              <span class="font-mono text-xs text-muted">{{ step.n }}</span>
              <p class="mt-3 font-medium text-highlighted">{{ step.title }}</p>
              <div class="mt-1.5 flex flex-col text-sm leading-relaxed text-muted">
                {{ step.body }}
                <code class="mt-4 self-start rounded-md border border-default bg-elevated px-2 py-1 font-mono text-xs text-highlighted">{{ step.snippet }}</code>
              </div>
            </LazyLandingSpotlightCard>
          </li>
        </ol>
      </section>

      <section class="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <h2 class="mb-6 text-2xl font-semibold tracking-tight text-highlighted">What's in it</h2>
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
        <h2 class="mb-6 text-2xl font-semibold tracking-tight text-highlighted">For one person or a team</h2>
        <div class="grid gap-4 md:grid-cols-2">
          <div class="rounded-lg border border-default p-6">
            <p class="label-mono">Personal</p>
            <p class="mt-3 text-lg font-medium tracking-tight text-highlighted">Deploy it, sign in, done.</p>
            <p class="mt-2 text-sm leading-relaxed text-muted">The first person to sign in is the admin. Nothing to configure. Your agents drop, you review.</p>
            <ul class="mt-5 space-y-2 text-sm">
              <li v-for="item in PERSONAL" :key="item" class="flex items-center gap-2">
                <UIcon name="i-lucide-check" class="size-4 text-muted" />{{ item }}
              </li>
            </ul>
          </div>
          <div class="rounded-lg border border-default p-6">
            <p class="label-mono">Team</p>
            <p class="mt-3 text-lg font-medium tracking-tight text-highlighted">Invite people. Three roles.</p>
            <p class="mt-2 text-sm leading-relaxed text-muted">Everyone can create drops. New people join as {{ ROLE_LABELS.member }}.</p>
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
            <p class="text-xl font-semibold tracking-tight text-highlighted">Give your agent somewhere to put its work.</p>
            <p class="mt-1 text-sm text-muted">Free and open source. Use ours or run your own.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton color="neutral" variant="ghost" label="Read the source" to="https://github.com/vite-hub/drop" target="_blank" />
            <UButton color="neutral" variant="outline" label="Open Drop" to="/drops" />
          </div>
        </div>
      </section>
    </main>

    <footer class="border-t border-default">
      <div class="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-muted sm:px-6">
        <span class="flex items-center gap-2">
          <ViteHubMark class="size-3.5" />Built with
          <a class="font-medium text-highlighted hover:underline" href="https://vitehub.dev" rel="noreferrer" target="_blank">ViteHub</a>
        </span>
        <span class="flex gap-5">
          <NuxtLink class="hover:text-highlighted" to="/docs">Docs</NuxtLink>
          <a class="hover:text-highlighted" href="https://github.com/vite-hub/drop" rel="noreferrer" target="_blank">GitHub</a>
        </span>
      </div>
    </footer>
  </div>
</template>
