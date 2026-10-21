<script setup lang="ts">
/**
 * "Open in Drop" from a reviewed site. The page knows only its review token, in the hash so it never reaches a log;
 * Drop opens the review from it for people who could open it anyway, and says so to everyone else.
 */
useSeoMeta({ title: "Open the review", robots: "noindex, nofollow" })

const route = useRoute("review-open")
const { data: me } = await useMe()
const ready = useMounted()
const error = ref("")

onMounted(async () => {
  // The router has decoded the hash already.
  const token = route.hash.slice(1)
  if (!token) return (error.value = "Press Comment on the site first, then open the review from there.")
  if (!me.value) return
  try {
    const { to } = await openReview(token)
    await navigateTo(to, { replace: true })
  } catch (cause) {
    error.value = errorText(cause, "Couldn't open this review.")
  }
})

const signInTo = computed(() => ({ path: "/signin", query: { redirect: route.fullPath } }))
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
        <template v-if="ready && error">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">Can't open the review</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted" role="alert">{{ error }}</p>
        </template>
        <template v-else-if="ready && !me">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">Sign in to open the review</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            The review opens for people it's shared with. Your comments reach its owner either way.
          </p>
          <UButton
            block
            class="mt-6"
            color="neutral"
            icon="i-simple-icons-github"
            label="Sign in with GitHub"
            :to="signInTo"
          />
        </template>
        <template v-else>
          <USkeleton class="h-6 w-2/3" />
          <USkeleton class="mt-3 h-4 w-full" />
        </template>
      </div>
    </div>
  </main>
</template>
