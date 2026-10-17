<script setup lang="ts">
/**
 * The popup a site's review script opens on its first Comment (shared/review-script.ts). It runs on Drop's origin,
 * with Drop's session, so it works where the site can't send Drop's cookies. It asks for a review token for the page
 * that opened it and posts it to the site's origin only; the server already refused any other origin.
 */
useSeoMeta({ title: "Comment on a site", robots: "noindex, nofollow" })

interface Issued { token: string; expiresAt: number; siteUrl: string; title: string; name: string }

const route = useRoute()
const { data: me } = await useMe()
const ready = useMounted()
const key = computed(() => (typeof route.query.d === "string" ? route.query.d : ""))
const origin = computed(() => (typeof route.query.origin === "string" ? route.query.origin : ""))
const host = computed(() => (URL.canParse(origin.value) ? new URL(origin.value).host : origin.value))

const state = ref<"loading" | "guest" | "signin" | "done" | "lost" | "error">("loading")
const site = ref<Issued | null>(null)
const name = ref("")
const pending = ref(false)
const error = ref("")

const issue = (guestName?: string) => $fetch<Issued>(`/api/review/${encodeURIComponent(key.value)}/token`, { method: "POST", body: { origin: origin.value, ...(guestName ? { name: guestName } : {}) } })

function handOver(issued: Issued) {
  site.value = issued
  // Without an opener (it was closed, or a sign-in page cut the link) the token has nowhere to go.
  if (!window.opener) return (state.value = "lost")
  window.opener.postMessage({ __dropReview: true, token: issued.token, expiresAt: issued.expiresAt, name: issued.name }, issued.siteUrl)
  state.value = "done"
  setTimeout(() => window.close(), 800)
}

async function connect(guestName?: string) {
  pending.value = true
  error.value = ""
  try {
    const issued = await issue(guestName)
    // Signed out, the first answer only says guests may comment: let them say who they are first.
    if (!me.value && guestName === undefined) {
      site.value = issued
      state.value = "guest"
    }
    else handOver(issued)
  }
  catch (cause) {
    const status = (cause as { statusCode?: number }).statusCode
    if (status === 401 && !me.value) state.value = "signin"
    else {
      error.value = errorText(cause, "Couldn't connect to this review.")
      state.value = "error"
    }
  }
  finally { pending.value = false }
}

onMounted(() => {
  if (!key.value || !origin.value) {
    error.value = "This link is missing the review or the site. Press Comment on the site again."
    state.value = "error"
    return
  }
  void connect()
})

const signInTo = computed(() => `/signin?redirect=${encodeURIComponent(route.fullPath)}`)
</script>

<template>
  <main class="grid min-h-dvh place-items-center bg-default px-4 py-12">
    <div class="w-full max-w-sm">
      <NuxtLink class="mb-8 flex items-center justify-center gap-2 font-semibold tracking-tight text-highlighted" to="/">
        <DropMark class="h-5 w-7" />Drop
      </NuxtLink>

      <div class="rounded-xl border border-default bg-default p-6">
        <template v-if="!ready || state === 'loading'">
          <USkeleton class="h-6 w-2/3" />
          <USkeleton class="mt-3 h-4 w-full" />
          <USkeleton class="mt-6 h-9 w-full" />
        </template>

        <template v-else-if="state === 'guest'">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">Comment on {{ site?.title ?? host }}</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">Your comments go to Drop with a screenshot of what you see on <span class="font-mono text-highlighted">{{ host }}</span>.</p>
          <UFormField class="mt-6" label="Your name" hint="Optional">
            <UInput v-model="name" class="w-full" :maxlength="60" placeholder="Guest" @keydown.enter="connect(name)" />
          </UFormField>
          <UButton block class="mt-4" color="neutral" label="Continue as a guest" :loading="pending" @click="connect(name)" />
          <UButton block class="mt-2" color="neutral" icon="i-simple-icons-github" label="Sign in with GitHub" :to="signInTo" variant="outline" />
        </template>

        <template v-else-if="state === 'signin'">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">Sign in to comment</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">Comments on <span class="font-mono text-highlighted">{{ host }}</span> go to a Drop review. Sign in to send yours.</p>
          <UButton block class="mt-6" color="neutral" icon="i-simple-icons-github" label="Sign in with GitHub" :to="signInTo" />
        </template>

        <template v-else-if="state === 'done'">
          <div class="flex items-center gap-3">
            <UIcon name="i-ph-check-circle" class="size-6 shrink-0 text-muted" />
            <h1 class="text-lg font-semibold tracking-tight text-highlighted">Connected</h1>
          </div>
          <p class="mt-2 text-sm leading-relaxed text-muted">Back on {{ host }}, drag over what you want to comment on. This window closes by itself.</p>
        </template>

        <template v-else-if="state === 'lost'">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">Go back to the site</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">This window lost track of the page that opened it. Press Comment on {{ host }} again{{ me ? "; you're signed in now, so it connects at once" : "" }}.</p>
        </template>

        <template v-else>
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">Can't comment here</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted" role="alert">{{ error }}</p>
        </template>
      </div>
    </div>
  </main>
</template>
