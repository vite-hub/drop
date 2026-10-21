<script setup lang="ts">
useSeoMeta({ title: "Sign in", robots: "noindex, nofollow" })

// Both requests at once: the page waits for the slower one, not the two in turn.
const [{ data: me }, { data: method }] = await Promise.all([useMe(), useSignInMethod()])
const { next, signIn } = useGitHubSignIn()
const { signOut } = useUserSession(useNuxtApp().$auth)
const pending = ref(false)
const error = ref("")
const dev = import.meta.dev

async function connect() {
  pending.value = true
  error.value = ""
  try {
    if (method.value?.proxy) {
      // One navigation: oauth2-proxy clears its cookie, then starts a fresh login. Signing out over fetch first
      // let the session refetch start a second login that overwrote this one's CSRF cookie.
      const start = `/oauth2/start?rd=${encodeURIComponent(next.value)}`
      await navigateTo(me.value ? `/oauth2/sign_out?rd=${encodeURIComponent(start)}` : start, { external: true })
      return
    }
    if (me.value) {
      const result = await signOut()
      if (result.error) throw new Error(result.error.message ?? "Couldn't sign out.")
      clearNuxtData()
    }
    const result = await signIn.social({
      provider: "github",
      callbackURL: next.value,
      additionalParams: { prompt: "select_account" },
    })
    if (result.error) throw new Error(result.error.message ?? "Couldn't start GitHub sign-in.")
  } catch (cause) {
    error.value = errorText(cause)
  } finally {
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
