<script setup lang="ts">
/**
 * Where an MCP client's sign-in lands (Better Auth's OAuth provider sends both its login and consent steps
 * here, with a signed `oauth_query`). Signed out: sign in with GitHub, and the provider resumes the
 * authorization by itself. Signed in: allow or deny the agent, then go back to it.
 */
useSeoMeta({ title: "Connect an agent", robots: "noindex" })

const route = useRoute("oauth")
const { $auth } = useNuxtApp()
const { loggedIn, user, signIn, ready: sessionKnown } = useUserSession($auth)
// Until the session is known, a signed-in person would see "Sign in" for a moment.
const mounted = useMounted()
const ready = computed(() => mounted.value && sessionKnown.value)

const clientId = computed(() => textValue(route.query.client_id) ?? "")
const valid = computed(() => Boolean(clientId.value && route.query.sig))

// The agent's name, as it registered itself ("Claude Code", "Codex"…). Readable once signed in, so it loads on the
// client when the session does.
const { data: client } = useAsyncData(
  keys.oauthClient,
  async () => {
    if (!loggedIn.value || !valid.value) return null
    const { data, error } = await $auth.oauth2.publicClient({ query: { client_id: clientId.value } })
    if (error) throw new Error(error.message || "Couldn't load this agent. Start the connection again.")
    return data
  },
  {
    server: false,
    watch: [loggedIn],
    default: () => null,
  },
)
const agentName = computed(() => client.value?.client_name || "An agent")

// Where Allow sends the agent's access. Anyone can register an agent under any name, so the name proves nothing; the
// redirect is part of this signed link, so it is where the code really goes.
const destination = computed(() => {
  const uri = textValue(route.query.redirect_uri) ?? ""
  if (!URL.canParse(uri)) return null
  const url = new URL(uri)
  if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    return { local: true, label: "an app on this computer" }
  if (!["http:", "https:"].includes(url.protocol))
    return { local: true, label: `the app that opens ${url.protocol} links` }
  return { local: false, label: url.host }
})

const pending = ref<"github" | "allow" | "deny" | null>(null)
const error = ref("")

async function signInWithGitHub() {
  pending.value = "github"
  error.value = ""
  try {
    const { error: failure } = await signIn.social({ provider: "github", callbackURL: "/drops" })
    if (failure) throw new Error(failure.message || "Couldn't start GitHub sign-in.")
  } catch (cause) {
    error.value = errorText(cause)
    pending.value = null
  }
}

async function answer(accept: boolean) {
  pending.value = accept ? "allow" : "deny"
  error.value = ""
  try {
    const { data, error: failure } = await $auth.oauth2.consent({ accept })
    if (failure)
      throw new Error(
        failure.message || "This authorization link is invalid or has expired. Start again from your agent.",
      )
    if (!data?.url) throw new Error("The agent didn't get an answer. Start again from your agent.")
  } catch (cause) {
    error.value = errorText(cause)
    pending.value = null
  }
}
</script>

<template>
  <main class="grid min-h-dvh place-items-center bg-default px-4 py-12">
    <div class="w-full max-w-sm">
      <NuxtLink
        class="mb-8 flex items-center justify-center gap-2 font-semibold tracking-tight text-highlighted"
        to="/"
      >
        <DropMark class="h-5 w-7" />Drop
      </NuxtLink>

      <div class="rounded-xl border border-default bg-default p-6">
        <template v-if="!valid">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">This link has expired</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            Start the connection again from your agent. It opens a fresh link.
          </p>
        </template>

        <template v-else-if="!ready">
          <USkeleton class="h-6 w-2/3" />
          <USkeleton class="mt-3 h-4 w-full" />
          <USkeleton class="mt-6 h-9 w-full" />
        </template>

        <template v-else-if="!loggedIn">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">Connect an agent to Drop</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            Sign in to choose whether it can drop docs and apps for you and read their comments.
          </p>
          <UButton
            block
            class="mt-6"
            color="neutral"
            icon="i-simple-icons-github"
            label="Sign in with GitHub"
            :loading="pending === 'github'"
            @click="signInWithGitHub"
          />
        </template>

        <template v-else>
          <div class="flex items-center gap-3">
            <span class="grid size-10 shrink-0 place-items-center rounded-lg border border-default bg-muted">
              <AgentIcon :name="agentName" kind="agent" class="size-5" />
            </span>
            <h1 class="text-lg leading-snug font-semibold tracking-tight text-highlighted">
              Allow {{ agentName }} to use Drop?
            </h1>
          </div>
          <p class="mt-3 text-sm leading-relaxed text-muted">It acts as {{ user?.email ?? user?.name ?? "you" }}:</p>
          <ul class="mt-2 space-y-1.5 text-sm">
            <li
              v-for="item in [
                'Drop docs and apps, private until you share them',
                'Read your drops and their comments',
                'Publish new versions',
              ]"
              :key="item"
              class="flex gap-2"
            >
              <UIcon name="i-mingcute-check-line" class="mt-0.5 size-4 shrink-0 text-muted" />{{ item }}
            </li>
          </ul>
          <p v-if="destination?.local" class="mt-4 text-xs leading-relaxed text-muted">
            Allow returns to {{ destination.label }}.
          </p>
          <p v-else-if="destination" class="mt-4 text-xs leading-relaxed text-warning">
            Allow gives this access to <span class="font-mono font-medium">{{ destination.label }}</span
            >. Only allow it if you started this connection from an agent that runs there.
          </p>
          <p class="mt-4 text-xs leading-relaxed text-muted">
            Private drops belong to this account on this Drop site. You can disconnect it any time on the Agents page.
          </p>
          <div class="mt-6 grid grid-cols-2 gap-2">
            <UButton
              block
              color="neutral"
              label="Deny"
              variant="outline"
              :disabled="pending !== null"
              :loading="pending === 'deny'"
              @click="answer(false)"
            />
            <UButton
              block
              color="neutral"
              label="Allow"
              :disabled="pending !== null"
              :loading="pending === 'allow'"
              @click="answer(true)"
            />
          </div>
        </template>

        <p v-if="error" class="mt-4 text-sm text-error" role="alert">{{ error }}</p>
      </div>
    </div>
  </main>
</template>
