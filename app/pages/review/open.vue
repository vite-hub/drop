<script setup lang="ts">
const route = useRoute("review-open")
const doc = route.hash.startsWith("#doc=") ? route.hash.slice(5) : null
const thing = doc === null ? "review" : "document"
useSeoMeta({ title: `Open the ${thing}`, robots: "noindex, nofollow" })

const { data: me } = await useMe()
const ready = useMounted()
const error = ref("")
const copying = doc === null && "copy" in route.query
const link = ref("")
const copied = ref(false)
function closeWindow() {
  if (import.meta.client) window.close()
}
const closeSoon = useTimeoutFn(closeWindow, 1200, { immediate: false })

async function copyLink() {
  try {
    await navigator.clipboard.writeText(link.value)
    copied.value = true
    closeSoon.start()
  } catch {
    copied.value = false
  }
}

onMounted(async () => {
  const token = route.hash.slice(1)
  if (!doc && !token)
    return (error.value = `Press Comment on the site first, then ${copying ? "copy" : "open"} the review from there.`)
  if (!me.value) return
  try {
    const found = await openReview(doc === null ? { token } : { doc })
    if (!copying || !("link" in found) || !found.link) return await navigateTo(found.to, { replace: true })
    link.value = found.link
    await copyLink()
  } catch (cause) {
    reportClientError("review-open", cause)
    error.value = errorText(cause, copying ? "Couldn't copy this review's link." : `Couldn't open this ${thing}.`)
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
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">
            {{ copying ? "Can't copy the review's link" : `Can't open the ${thing}` }}
          </h1>
          <p class="mt-2 text-sm leading-relaxed text-muted" role="alert">{{ error }}</p>
        </template>
        <template v-else-if="ready && !me">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">
            {{ copying ? "Sign in to copy the review's link" : `Sign in to open the ${thing}` }}
          </h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            {{
              doc === null
                ? "The review opens for people it's shared with. Your comments reach its owner either way."
                : "The document opens for people it's shared with."
            }}
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
        <template v-else-if="ready && link">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted" role="status">
            {{ copied ? "Link copied" : "The review's link" }}
          </h1>
          <p class="mt-2 truncate text-sm text-muted">{{ link }}</p>
          <UButton
            v-if="!copied"
            block
            class="mt-6"
            color="neutral"
            icon="i-mingcute-link-line"
            label="Copy link"
            @click="copyLink"
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
