<script setup lang="ts">
// A site drop's page: the website under review and the ways to comment on it. Opening it here in Drop comes first; the
// bookmarklet (for sites that refuse frames) and the optional tag in preview builds sit below it. Feedback and
// screenshots live in the viewer's bottom review dock.
import { isSitePattern, reviewBookmarklet, reviewSnippet, siteCovers, siteHost } from "#shared/review"
import type { DropDetail } from "#shared/types"

const props = defineProps<{ drop: DropDetail; publicView: boolean }>()

const notify = useNotify()
const origin = useRequestURL().origin
const snippet = reviewSnippet(origin)
const bookmarklet = reviewBookmarklet(origin)
const host = computed(() => (props.drop.siteUrl ? siteHost(props.drop.siteUrl) : ""))
const pattern = computed(() => Boolean(props.drop.siteUrl && isSitePattern(props.drop.siteUrl)))
// A pattern has no one address to open; its comments carry their page's origin instead.
const siteLink = computed(() => (props.drop.siteUrl && !pattern.value ? props.drop.siteUrl : null))
// Where the bookmarklet goes in the reader's browser. Guessed after mounting, so the server's HTML (Chrome's wording)
// and the first client render match. Firefox also bookmarks it from the right-click menu, for anyone who can't drag.
type Browser = "chrome" | "firefox" | "safari"
const browser = ref<Browser>("chrome")
onMounted(() => {
  const agent = navigator.userAgent
  if (/Firefox\//.test(agent)) browser.value = "firefox"
  else if (/Safari\//.test(agent) && !/Chrome\/|Chromium\//.test(agent)) browser.value = "safari"
})
const BAR_KEYS = ["meta", "shift", "b"]
const bar = computed(
  () => ({ chrome: "bookmarks bar", firefox: "bookmarks toolbar", safari: "Favorites bar" })[browser.value],
)
const afterBar = computed(
  () =>
    (browser.value === "firefox" ? ", or right-click it and choose Bookmark Link. Then click" : ", then click") +
    ` it on any page of ${host.value}.`,
)
// The address to open in ViewerSiteFrame. A pattern starts empty, since each preview has its own.
const address = ref("")
watch(siteLink, (link) => (address.value ||= link ?? ""), { immediate: true })
const addressCovered = computed(() => siteCovers(props.drop.siteUrl, address.value))
const addressError = ref("")
watch(address, () => (addressError.value = ""))
const example = computed(() => props.drop.siteUrl?.replace("*", "pr123") ?? "")
const framed = ref<string | null>(null)
const siteFrame = useTemplateRef<{ comment: () => Promise<void>; cancel: () => void; drawing: boolean }>("siteFrame")
defineExpose({
  canDraw: computed(() => Boolean(framed.value)),
  drawing: computed(() => siteFrame.value?.drawing ?? false),
  comment: () => siteFrame.value?.comment(),
  cancel: () => siteFrame.value?.cancel(),
})
function openHere(event: SubmitEvent) {
  if (addressCovered.value) {
    framed.value = new URL(address.value).href
    return
  }
  addressError.value = pattern.value
    ? `Enter a preview that matches ${props.drop.siteUrl}, like ${example.value}.`
    : `Enter an address on ${props.drop.siteUrl}.`
  ;(event.target as HTMLFormElement).querySelector("input")?.focus()
}
</script>

<template>
  <ViewerSiteFrame v-if="framed" ref="siteFrame" :address="framed" :drop="drop" @close="framed = null" />
  <div v-else class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto max-w-3xl space-y-10 px-4 py-10 sm:px-6">
      <section class="space-y-3">
        <form v-if="drop.canComment" class="flex items-center gap-2" novalidate @submit.prevent="openHere">
          <UInput
            v-model="address"
            class="min-w-0 flex-1"
            color="error"
            :highlight="Boolean(addressError)"
            icon="i-mingcute-world-2-line"
            :placeholder="example"
            size="lg"
            spellcheck="false"
            type="url"
            autocomplete="off"
            name="address"
            :ui="{ base: 'font-mono' }"
            aria-label="Address to review"
            :aria-invalid="Boolean(addressError) || undefined"
            :aria-describedby="addressError ? 'site-address-error' : undefined"
          />
          <UButton
            color="neutral"
            label="Review here"
            size="lg"
            trailing-icon="i-mingcute-arrow-right-line"
            type="submit"
          />
          <UTooltip v-if="addressCovered" text="Open in a new tab">
            <UButton
              aria-label="Open in a new tab"
              color="neutral"
              external
              icon="i-mingcute-external-link-line"
              size="lg"
              target="_blank"
              :to="address"
              variant="outline"
            />
          </UTooltip>
        </form>
        <div v-else class="flex items-center gap-2">
          <span
            class="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-elevated px-3 py-2 font-mono text-sm text-highlighted"
          >
            <UIcon name="i-mingcute-world-2-line" class="size-4 shrink-0 text-muted" />
            <span class="truncate">{{ drop.siteUrl }}</span>
          </span>
          <UButton
            v-if="siteLink"
            color="neutral"
            external
            icon="i-mingcute-external-link-line"
            label="Open site"
            size="lg"
            target="_blank"
            :to="siteLink"
            variant="outline"
          />
        </div>
        <p v-if="addressError" id="site-address-error" class="text-sm text-pretty text-error">{{ addressError }}</p>
        <p v-else-if="drop.canComment" class="text-sm text-pretty text-muted">
          <template v-if="pattern">
            Paste any preview that matches <span class="font-mono text-default">{{ drop.siteUrl }}</span
            >.
          </template>
          Then choose Mark area in the bottom bar, or press <UKbd value="R" />, and drag over what you mean. Your
          browser asks once to share the screen for the screenshot.
        </p>
        <p v-else-if="pattern" class="text-sm text-pretty text-muted">
          Covers every preview that matches <span class="font-mono text-default">{{ drop.siteUrl }}</span
          >.
        </p>
      </section>

      <section v-if="drop.canComment" class="space-y-3">
        <h2 class="label-mono">Other ways to comment</h2>
        <ul class="divide-y divide-default">
          <li class="flex flex-wrap items-center gap-x-6 gap-y-3 pb-5 last:pb-0">
            <div class="min-w-0 flex-1 space-y-1">
              <h3 class="text-sm font-medium text-highlighted">Bookmarklet</h3>
              <p class="text-sm text-pretty text-muted">
                For sites that stay blank here. Drag the button to your {{ bar }}
                <span class="inline-flex gap-0.5 align-middle"
                  ><UKbd v-for="key in BAR_KEYS" :key="key" :value="key" /></span
                >{{ afterBar }}
              </p>
            </div>
            <!-- A bookmarklet: dragged to the bookmarks bar, never run here. -->
            <a
              class="inline-flex h-8 shrink-0 cursor-grab items-center gap-1.5 rounded-md border border-default bg-elevated px-3 text-sm font-medium text-highlighted transition-colors hover:bg-accented focus-visible:ring-2 focus-visible:ring-inverted focus-visible:outline-none active:cursor-grabbing"
              :href="bookmarklet"
              @click.prevent="notify.done(`Drag it to your ${bar}`, `Then click it on any page of ${host}.`)"
            >
              <UIcon name="i-mingcute-chat-1-line" class="size-4 text-muted" />Review with Drop
            </a>
          </li>
          <li v-if="drop.isOwner" class="space-y-3 pt-5">
            <div class="space-y-1">
              <h3 class="text-sm font-medium text-highlighted">Comment button on previews</h3>
              <p class="text-sm text-pretty text-muted">
                Add this tag to preview builds, never production. Each preview gets a Comment button, and only people
                this review is shared with can use it. A strict Content Security Policy needs to allow {{ origin }}.
              </p>
            </div>
            <AgentsCodeBlock :code="snippet" />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
