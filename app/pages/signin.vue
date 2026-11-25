<script setup lang="ts">
import { signInPath } from "#shared/sign-in"

useSeoMeta({ title: "Sign in", robots: "noindex, nofollow" })

const [{ data: me }, { data: method }] = await Promise.all([useMe(), useSignInMethod()])
const { next, signIn } = useGitHubSignIn()
const { signOut } = useUserSession(useNuxtApp().$auth)
const pending = ref(false)
const error = ref("")
const dev = import.meta.dev
const leave = (url: string) => navigateTo(url, { external: true })

async function connect() {
  pending.value = true
  error.value = ""
  const switchingProxyAccount = method.value?.proxy && !!me.value
  try {
    if (method.value?.proxy) {
      const start = signInPath(next.value, { proxy: true })
      await (switchingProxyAccount ? switchProxyAccount(start, { signOut, navigate: leave }) : leave(start))
      return
    }
    if (me.value) {
      const result = await signOut()
      if (result.error) throw answerError(result.error.message ?? "Couldn't sign out.", result.error.status)
      clearNuxtData()
    }
    const result = await signIn.social({
      provider: "github",
      callbackURL: next.value,
      additionalParams: { prompt: "select_account" },
    })
    if (result.error) throw answerError(result.error.message ?? "Couldn't start GitHub sign-in.", result.error.status)
  } catch (cause) {
    reportClientError(switchingProxyAccount ? "signin-switch" : "signin", cause)
    error.value = errorText(cause)
    pending.value = false
  }
}
</script>

<template>
  <main class="grid min-h-dvh place-items-center px-6 py-12">
    <div class="w-full max-w-sm">
      <NuxtLink class="mb-8 flex justify-center gap-2 font-semibold text-highlighted" to="/"
        ><DropMark class="h-5 w-7" />Drop</NuxtLink
      >
      <div class="rounded-xl border border-default p-6">
        <h1 class="text-lg font-semibold text-highlighted">
          {{ me ? "Choose your Drop account" : "Sign in to Drop" }}
        </h1>
        <p v-if="me" class="mt-2 text-sm text-muted">
          Signed in as <span class="font-medium text-highlighted">{{ me.email }}</span
          >.
        </p>
        <p class="mt-2 text-sm leading-relaxed text-muted">
          The first sign-in creates your account. Use the same account your agent connects with: private drops belong to
          it.
        </p>
        <UButton
          block
          class="mt-6"
          color="neutral"
          icon="i-simple-icons-github"
          :label="me ? 'Use another GitHub account' : 'Sign in with GitHub'"
          :loading="pending"
          @click="connect"
        />
        <UButton
          v-if="me"
          block
          class="mt-2"
          color="neutral"
          label="Continue with this account"
          :to="next"
          variant="outline"
          :disabled="pending"
        />
        <p v-if="error" class="mt-4 text-sm text-error" role="alert">{{ error }}</p>
      </div>
      <DevSignIn v-if="dev && !me" class="mt-4" />
    </div>
  </main>
</template>
