<script setup lang="ts">
// `nuxt dev` has no GitHub app, so server/auth.ts turns on email and password there. This form is the only way in
// locally: sign in, or create the first account (and a teammate's) without reaching for the API.
const { next, signIn } = useGitHubSignIn()
const { $auth } = useNuxtApp()
const creating = ref(false)
const form = reactive({ name: "", email: "", password: "", error: "", pending: false })

async function submit() {
  form.pending = true
  form.error = ""
  const { error } = creating.value
    ? await $auth.signUp.email({ name: form.name || form.email.split("@")[0]!, email: form.email, password: form.password })
    : await signIn.email({ email: form.email, password: form.password, callbackURL: next.value })
  form.pending = false
  if (error) form.error = error.message ?? (creating.value ? "Couldn't create the account." : "Couldn't sign in.")
  else {
    clearNuxtData(keys.me)
    await navigateTo(next.value)
  }
}
</script>

<template>
  <form class="flex w-full flex-col gap-2 rounded-lg border border-dashed border-accented bg-default p-3 text-left" @submit.prevent="submit">
    <p class="label-mono">Dev sign-in</p>
    <UInput v-if="creating" v-model="form.name" autocomplete="name" placeholder="Name" size="sm" />
    <UInput v-model="form.email" autocomplete="email" placeholder="Email" size="sm" type="email" required />
    <UInput v-model="form.password" :autocomplete="creating ? 'new-password' : 'current-password'" minlength="8" placeholder="Password" size="sm" type="password" required />
    <UButton block color="neutral" variant="outline" size="sm" :label="creating ? 'Create account' : 'Sign in'" :loading="form.pending" type="submit" />
    <p v-if="form.error" class="text-xs text-error" role="alert">{{ form.error }}</p>
    <button class="cursor-pointer text-xs text-muted hover:text-highlighted" type="button" @click="creating = !creating">
      {{ creating ? "Have an account? Sign in" : "No account yet? Create one" }}
    </button>
  </form>
</template>
