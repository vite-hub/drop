<script setup lang="ts">
// A site drop's page: the address to open the website at, then its comments. The other ways to comment (the bookmarklet
// for sites that refuse frames, the tag for preview builds) fold away below once there's feedback to read. A comment's
// thread opens in the viewer's bottom review dock.
import { isSitePattern, reviewBookmarklet, reviewSnippet, siteCovers, siteHost } from "#shared/review"
import type { DropComment, DropDetail, SiteReviewItem } from "#shared/types"

const props = defineProps<{
  drop: DropDetail
  reviewing: boolean
  comments: DropComment[]
  screenshots: Map<string, SiteReviewItem["screenshot"]>
}>()
const emit = defineEmits<{ focus: [comment: DropComment]; resolve: [id: string, resolved: boolean] }>()

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
const siteFrame = useTemplateRef<{
  pending: boolean
  capturing: boolean
}>("siteFrame")
defineExpose({
  capturing: computed(() => siteFrame.value?.capturing ?? false),
  canDraw: computed(() => Boolean(framed.value)),
  pending: computed(() => siteFrame.value?.pending ?? false),
})
// Where a comment was written, as an address the frame can open: a pattern's comments carry their preview's origin.
function pageUrl(comment: DropComment) {
  const page = comment.page
  if (!page) return undefined
  const url = /^https?:\/\//.test(page)
    ? page
    : siteLink.value && page.startsWith("/")
      ? new URL(page, siteLink.value).href
      : ""
  return url && siteCovers(props.drop.siteUrl, url) ? url : undefined
}
// Ways to comment start open until the first comment, then fold away under the feedback.
const setupOpen = ref(props.comments.length === 0)
function openHere(event: SubmitEvent) {
  if (addressCovered.value) {
    framed.value = new URL(address.value).href
    return
  }
  addressError.value = pattern.value
    ? `Enter a preview that matches ${props.drop.siteUrl}, like ${example.value}.`
    : `Enter an address on ${props.drop.siteUrl}.`
  if (event.currentTarget instanceof HTMLFormElement) event.currentTarget.querySelector("input")?.focus()
}
</script>

<template>
  <ViewerSiteFrame
    v-if="framed"
    ref="siteFrame"
    :address="framed"
    :drop="drop"
    :reviewing="reviewing"
    @close="framed = null"
  />
  <div v-else class="min-h-0 flex-1 overflow-y-auto">
    <!-- The review dock floats over this page, so its end clears it. -->
    <div class="mx-auto max-w-3xl space-y-8 px-4 pt-10 pb-36 sm:px-6 sm:pb-28">
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
          Open it here, then drag over anything to comment on it, or press <UKbd value="R" />. Your browser asks to
          share the screen only when you mark an area.
        </p>
        <p v-else-if="pattern" class="text-sm text-pretty text-muted">
          Covers every preview that matches <span class="font-mono text-default">{{ drop.siteUrl }}</span
          >.
        </p>
      </section>

      <ViewerSiteComments
        :can-manage="drop.isOwner"
        :comments="comments"
        :page-url="pageUrl"
        :pattern="pattern"
        :screenshots="screenshots"
        @focus="emit('focus', $event)"
        @resolve="(id, resolved) => emit('resolve', id, resolved)"
        @review="(url) => (framed = url)"
      />

      <details
        v-if="drop.canComment"
        class="group/setup rounded-lg border border-default"
        :open="setupOpen"
        @toggle="setupOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary
          class="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-4 text-sm font-medium text-highlighted transition-colors duration-150 select-none focus-visible:ring-2 focus-visible:ring-inverted focus-visible:outline-none pointer-fine:hover:bg-elevated/50 [&::-webkit-details-marker]:hidden"
        >
          <UIcon
            name="i-mingcute-right-line"
            class="size-4 text-muted transition-transform duration-150 ease-(--ease-out) group-open/setup:rotate-90 motion-reduce:transition-none"
          />
          Other ways to comment
          <span class="ml-auto text-xs font-normal text-muted"
            >Bookmarklet{{ drop.isOwner ? ", preview tag" : "" }}</span
          >
        </summary>
        <ul class="divide-y divide-default border-t border-default px-4">
          <li class="flex flex-wrap items-center gap-x-6 gap-y-3 py-4">
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
            <UTooltip :text="`Drag it to your ${bar}, then click it on any page of ${host}`">
              <a
                class="inline-flex h-8 shrink-0 cursor-grab items-center gap-1.5 rounded-md border border-default bg-elevated px-3 text-sm font-medium text-highlighted transition-colors hover:bg-accented focus-visible:ring-2 focus-visible:ring-inverted focus-visible:outline-none active:cursor-grabbing"
                :href="bookmarklet"
                @click.prevent
              >
                <UIcon name="i-mingcute-chat-1-line" class="size-4 text-muted" />Review with Drop
              </a>
            </UTooltip>
          </li>
          <li v-if="drop.isOwner" class="space-y-3 py-4">
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
      </details>
    </div>
  </div>
</template>
