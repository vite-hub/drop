<script setup lang="ts">
/**
 * The popup a site's review script opens on its first Comment (shared/review-script.ts). It runs on Drop's origin,
 * with Drop's session, so it works where the site can't send Drop's cookies. It looks up the site drops that cover the
 * page that opened it and that this person may comment on, lets them pick one when there are several, and posts a
 * review token to the page's origin only; the server already refused any other origin.
 */
useSeoMeta({ title: "Comment on a site", robots: "noindex, nofollow" })

const route = useRoute("review-connect")
const { data: me } = await useMe()
const ready = useMounted()
const origin = computed(() => textValue(route.query.origin) ?? "")
const host = computed(() => (URL.canParse(origin.value) ? new URL(origin.value).host : origin.value))

const state = ref<"loading" | "guest" | "choose" | "signin" | "none" | "done" | "lost" | "error">("loading")
const sites = ref<ReviewSite[]>([])
const issued = ref<ReviewToken | null>(null)
const name = ref("")
const pending = ref<string | null>(null)
const error = ref("")

function handOver(answer: ReviewToken) {
  issued.value = answer
  // Without an opener (it was closed, or a sign-in page cut the link) the token has nowhere to go.
  if (!window.opener) return (state.value = "lost")
  window.opener.postMessage(
    { __dropReview: true, token: answer.token, expiresAt: answer.expiresAt, name: answer.name },
    answer.origin,
  )
  state.value = "done"
  setTimeout(() => window.close(), 800)
}

async function connect(site: ReviewSite) {
  pending.value = site.choice
  error.value = ""
  try {
    handOver(
      await issueReviewToken({ origin: origin.value, choice: site.choice, ...(me.value ? {} : { name: name.value }) }),
    )
  } catch (cause) {
    error.value = errorText(cause, "Couldn't connect to this review.")
    state.value = "error"
  } finally {
    pending.value = null
  }
}

onMounted(async () => {
  if (!origin.value) {
    error.value = "This link is missing the site. Press Comment on the site again."
    state.value = "error"
    return
  }
  try {
    sites.value = (await reviewSites(origin.value)).sites
  } catch (cause) {
    error.value = errorText(cause, "Couldn't look up this site's review.")
    state.value = "error"
    return
  }
  if (!sites.value.length) state.value = me.value ? "none" : "signin"
  // Signed out, guests say who they are first.
  else if (!me.value) state.value = "guest"
  else if (sites.value.length === 1) await connect(sites.value[0]!)
  else state.value = "choose"
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
        <template v-if="!ready || state === 'loading'">
          <USkeleton class="h-6 w-2/3" />
          <USkeleton class="mt-3 h-4 w-full" />
          <USkeleton class="mt-6 h-9 w-full" />
        </template>

        <template v-else-if="state === 'guest'">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">
            Comment on {{ sites.length === 1 ? sites[0]!.title : host }}
          </h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            Your comments go to Drop with a screenshot of what you see on
            <span class="font-mono text-highlighted">{{ host }}</span
            >.
          </p>
          <UFormField class="mt-6" label="Your name" hint="Optional">
            <UInput
              v-model="name"
              class="w-full"
              :maxlength="60"
              placeholder="Guest"
              @keydown.enter="sites.length === 1 && connect(sites[0]!)"
            />
          </UFormField>
          <UButton
            v-if="sites.length === 1"
            block
            class="mt-4"
            color="neutral"
            label="Continue as a guest"
            :loading="pending !== null"
            @click="connect(sites[0]!)"
          />
          <template v-else>
            <p class="mt-6 text-sm font-medium text-highlighted">Pick the review</p>
            <ReviewSiteList class="mt-2" :pending="pending" :sites="sites" @pick="connect" />
          </template>
          <UButton
            block
            class="mt-2"
            color="neutral"
            icon="i-simple-icons-github"
            label="Sign in with GitHub"
            :to="signInTo"
            variant="outline"
          />
        </template>

        <template v-else-if="state === 'choose'">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">Pick the review</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            More than one review covers <span class="font-mono text-highlighted">{{ host }}</span
            >. Your comments go to the one you pick.
          </p>
          <ReviewSiteList class="mt-6" :pending="pending" :sites="sites" @pick="connect" />
        </template>

        <template v-else-if="state === 'signin'">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">Sign in to comment</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            Reviews of <span class="font-mono text-highlighted">{{ host }}</span> take comments from people they're
            shared with. Sign in, or ask the site's owner for a link that lets anyone comment.
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

        <template v-else-if="state === 'none'">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">No review for you here</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            No review of <span class="font-mono text-highlighted">{{ host }}</span> is shared with you. Ask the site's
            owner to share it, or create one from your Drops.
          </p>
          <UButton
            block
            class="mt-6"
            color="neutral"
            label="Open Drops"
            target="_blank"
            to="/drops"
            variant="outline"
          />
        </template>

        <template v-else-if="state === 'done'">
          <div class="flex items-center gap-3">
            <UIcon name="i-ph-check-circle" class="size-6 shrink-0 text-muted" />
            <h1 class="text-lg font-semibold tracking-tight text-highlighted">Connected</h1>
          </div>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            Back on {{ host }}, drag over what you want to comment on. Your comments go to {{ issued?.title }}. This
            window closes by itself.
          </p>
        </template>

        <template v-else-if="state === 'lost'">
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">Go back to the site</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted">
            This window lost track of the page that opened it. Press Comment on {{ host }} again{{
              me ? "; you're signed in now, so it connects at once" : ""
            }}.
          </p>
        </template>

        <template v-else>
          <h1 class="text-lg font-semibold tracking-tight text-highlighted">Can't comment here</h1>
          <p class="mt-2 text-sm leading-relaxed text-muted" role="alert">{{ error }}</p>
        </template>
      </div>
    </div>
  </main>
</template>
