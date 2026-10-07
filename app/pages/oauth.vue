<script setup lang="ts">
/**
 * Where an MCP client's sign-in lands (Better Auth's OAuth provider sends both its login and consent steps
 * here, with a signed `oauth_query`). Signed out: sign in with GitHub, and the provider resumes the
 * authorization by itself. Signed in: allow or deny the agent, then go back to it.
 */
useSeoMeta({ title: "Connect an agent", robots: "noindex" })

const route = useRoute()
const { loggedIn, user } = useUserSession()
const mounted = useMounted()
const ready = computed(() => mounted.value)

// The whole signed query goes back verbatim; the provider checks its signature.
const oauthQuery = computed(() => (import.meta.client ? location.search.slice(1) : ""))
const clientId = computed(() => (typeof route.query.client_id === "string" ? route.query.client_id : ""))
const valid = computed(() => Boolean(clientId.value && route.query.sig))

// The agent's name, as it registered itself ("Claude Code", "Codex"…). Readable once signed in.
const { data: client, execute: loadClient } = useApi<{ client_name?: string }>("/api/auth/oauth2/public-client", {
  key: "oauth-client",
  query: { client_id: clientId },
  immediate: false,
  server: false,
  watch: false,
})
const agentName = computed(() => client.value?.client_name || "An agent")
watch([ready, loggedIn], () => {
  if (ready.value && loggedIn.value && valid.value && !client.value) void loadClient()
}, { immediate: true })

const pending = ref<"github" | "allow" | "deny" | null>(null)
const error = ref("")

async function signInWithGitHub() {
  pending.value = "github"
  error.value = ""
  try {
    const { url } = await $fetch<{ url: string }>("/api/auth/sign-in/social", { method: "POST", body: { provider: "github", callbackURL: "/drops", oauth_query: oauthQuery.value } })
    window.location.href = url
  }
  catch (cause) {
    error.value = errorText(cause)
    pending.value = null
  }
}

async function answer(accept: boolean) {
  pending.value = accept ? "allow" : "deny"
  error.value = ""
  try {
    const result = await $fetch<{ redirect_uri?: string; url?: string }>("/api/auth/oauth2/consent", { method: "POST", body: { accept, oauth_query: oauthQuery.value } })
    const next = result.redirect_uri ?? result.url
    if (!next) throw new Error("The agent didn't get an answer. Start again from your agent.")
    window.location.href = next
  }
  catch (cause) {
    error.value = errorText(cause)
    pending.value = null
  }
}
</script>

<template>
  <main class="grid min-h-dvh place-items-center bg-default px-4 py-12">
    <div class="w-full max-w-sm">
      <NuxtLink class="mb-8 flex items-center justify-center gap-2 font-semibold tracking-tight text-highlighted" to="/">
        <DropMark class="h-5 w-7" />Drop
      </NuxtLink>

      <div class="rounded-xl border border-default bg-default p-6 shadow-sm">
        <template v-if="!valid">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">This link has expired</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">Start the connection again from your agent. It opens a fresh link.</p>
        </template>

        <template v-else-if="!ready">
          <USkeleton class="h-6 w-2/3" />
          <USkeleton class="mt-3 h-4 w-full" />
          <USkeleton class="mt-6 h-9 w-full" />
        </template>

        <template v-else-if="!loggedIn">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">Connect an agent to Drop</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">Sign in to choose whether it can drop docs and apps for you and read their comments.</p>
          <UButton block class="mt-6" color="neutral" icon="i-simple-icons-github" label="Sign in with GitHub" :loading="pending === 'github'" @click="signInWithGitHub" />
        </template>

        <template v-else>
          <div class="flex items-center gap-3">
            <span class="grid size-10 shrink-0 place-items-center rounded-lg border border-default bg-muted">
              <AgentIcon :name="agentName" kind="agent" class="size-5" />
            </span>
            <h1 class="text-lg leading-snug font-semibold tracking-tight text-highlighted">Allow {{ agentName }} to use Drop?</h1>
          </div>
          <p class="mt-3 text-sm leading-relaxed text-muted">It acts as {{ user?.name ?? "you" }}:</p>
          <ul class="mt-2 space-y-1.5 text-sm">
            <li v-for="item in ['Drop docs and apps, private until you share them', 'Read your drops and their comments', 'Publish new versions']" :key="item" class="flex gap-2">
              <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-muted" />{{ item }}
            </li>
          </ul>
          <p class="mt-4 text-xs leading-relaxed text-muted">You can disconnect it any time on the Agents page.</p>
          <div class="mt-6 grid grid-cols-2 gap-2">
            <UButton block color="neutral" label="Deny" variant="outline" :disabled="pending !== null" :loading="pending === 'deny'" @click="answer(false)" />
            <UButton block color="neutral" label="Allow" :disabled="pending !== null" :loading="pending === 'allow'" @click="answer(true)" />
          </div>
        </template>

        <p v-if="error" class="mt-4 text-sm text-error" role="alert">{{ error }}</p>
      </div>
    </div>
  </main>
</template>
