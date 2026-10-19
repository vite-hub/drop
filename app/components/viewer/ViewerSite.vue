<script setup lang="ts">
// A site drop's page: the website under review, the three ways to comment on it (open it here in Drop, the bookmarklet,
// or the optional tag in preview builds), and what people sent from its pages, newest first. Each screenshot opens as
// its own image, where the box shows and the thread continues.
import { dropPath } from "#shared/links"
import { isSitePattern, reviewBookmarklet, reviewSnippet, siteHost, siteMatches } from "#shared/review"
import type { DropDetail, SiteReviewItem } from "#shared/types"

/** `inset`: room to leave on the right for the floating panel, in pixels. */
const props = defineProps<{ drop: DropDetail; publicView: boolean; inset: number }>()

const state = injectDrop()!
const items = useApi<SiteReviewItem[]>(() => `/api/drops/${props.drop.id}/review`, { key: () => keys.review(props.drop.id), default: () => [] })
const notify = useNotify()
const origin = useRequestURL().origin
const snippet = reviewSnippet(origin)
const bookmarklet = reviewBookmarklet(origin)
const host = computed(() => (props.drop.siteUrl ? siteHost(props.drop.siteUrl) : ""))
// A pattern has no one address to open; its comments carry their page's origin instead.
const siteLink = computed(() => (props.drop.siteUrl && !isSitePattern(props.drop.siteUrl) ? props.drop.siteUrl : null))
const pageLink = (page: string | null) => (page?.startsWith("http") ? page : page && siteLink.value ? siteLink.value + page : null)
// Resolving from the panel updates the drop's comments; the list follows them.
const resolved = (item: SiteReviewItem) => state.comments.data.value.find(comment => comment.id === item.id)?.resolved ?? item.resolved
const shotTo = (shot: NonNullable<SiteReviewItem["screenshot"]>) => (props.publicView ? dropPath(shot) : `/drops/${shot.id}`)
// The bookmarklet's steps for the reader's browser. Guessed after mounting, so the server's HTML (Chrome's steps) and
// the first client render match; the buttons fix a wrong guess.
type Browser = "chrome" | "firefox" | "safari"
const BROWSERS: { id: Browser; label: string }[] = [
  { id: "chrome", label: "Chrome, Edge, Brave" },
  { id: "firefox", label: "Firefox, Zen" },
  { id: "safari", label: "Safari" },
]
const browser = ref<Browser>("chrome")
onMounted(() => {
  const agent = navigator.userAgent
  if (/Firefox\//.test(agent)) browser.value = "firefox"
  else if (/Safari\//.test(agent) && !/Chrome\/|Chromium\//.test(agent)) browser.value = "safari"
})
interface Step { text: string; keys?: string[]; after?: string }
const steps = computed<Step[]>(() => {
  const open = { text: `Open any page of ${host.value}, click Review with Drop in your bookmarks, press Comment, and drag over what you mean. Your note lands here with a screenshot.` }
  if (browser.value === "firefox") return [
    { text: "Show the bookmarks toolbar with", keys: ["meta", "shift", "b"], after: ". In Zen's single toolbar, it appears when you point at the top edge of the window." },
    { text: "Drag the Review with Drop button onto it. Or right-click the button, choose Bookmark Link, and save it." },
    open,
  ]
  if (browser.value === "safari") return [
    { text: "Show the Favorites bar with", keys: ["meta", "shift", "b"], after: "." },
    { text: "Drag the Review with Drop button onto it." },
    open,
  ]
  return [
    { text: "Show the bookmarks bar with", keys: ["meta", "shift", "b"], after: "." },
    { text: "Drag the Review with Drop button onto it." },
    open,
  ]
})
// Review it here: the address to open in ViewerSiteFrame. A pattern starts empty, since each preview has its own.
const address = ref("")
watch(siteLink, link => (address.value ||= link ?? ""), { immediate: true })
const addressCovered = computed(() => {
  try { return Boolean(props.drop.siteUrl) && siteMatches(props.drop.siteUrl!, new URL(address.value).origin) }
  catch { return false }
})
const example = computed(() => props.drop.siteUrl?.replace("*", "pr123") ?? "")
const framed = ref<string | null>(null)
function openHere() {
  if (addressCovered.value) framed.value = new URL(address.value).href
}
const box = (item: SiteReviewItem) => ({ left: `${item.ox / 10}%`, top: `${item.oy / 10}%`, width: `${item.ow / 10}%`, height: `${item.oh / 10}%` })
</script>

<template>
  <ViewerSiteFrame v-if="framed" :address="framed" :drop="drop" :inset="inset" @close="framed = null" />
  <div v-else class="min-h-0 flex-1 overflow-y-auto">
    <div class="mx-auto max-w-4xl space-y-10 px-4 py-8 sm:px-6" :style="{ paddingRight: inset ? `${inset}px` : undefined }">
      <section class="space-y-3">
        <p class="label-mono">Site</p>
        <div class="flex flex-wrap items-center gap-3">
          <span class="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-elevated px-2.5 py-1.5 font-mono text-sm text-highlighted">
            <UIcon name="i-ph-globe" class="size-4 shrink-0 text-muted" />
            <span class="truncate">{{ drop.siteUrl }}</span>
          </span>
          <UButton v-if="siteLink" color="neutral" external icon="i-ph-arrow-square-out" label="Open site" target="_blank" :to="siteLink" variant="outline" />
        </div>
        <p v-if="drop.siteUrl && isSitePattern(drop.siteUrl)" class="text-sm text-muted">Covers every address where <span class="font-mono">*</span> is one label, like each pull request's preview.</p>
      </section>

      <section v-if="drop.canComment" class="space-y-3">
        <p class="label-mono">Review it here</p>
        <p class="text-sm text-muted">Open the site inside Drop, press Comment, and drag over what you mean. Drop takes the screenshot with your browser's screen sharing, which asks once. Nothing to install.</p>
        <form class="flex flex-wrap items-center gap-2" @submit.prevent="openHere">
          <UInput v-model="address" class="min-w-0 flex-1" icon="i-ph-globe" :placeholder="example" spellcheck="false" aria-label="Address to review" />
          <UButton color="neutral" :disabled="!addressCovered" label="Open here" trailing-icon="i-ph-arrow-right" type="submit" />
        </form>
        <p class="text-sm text-muted">If the page stays blank, the site doesn't allow being shown in a frame; use the bookmarklet below.</p>
      </section>

      <section v-if="drop.canComment && drop.isOwner" class="space-y-3">
        <p class="label-mono">Or add the Comment button to previews</p>
        <p class="text-sm text-muted">Add this tag to the site's preview builds once, never production. Every preview then shows a Comment button, so nobody installs anything, and comments from every preview land here. It carries no key: people still need this review shared with them to comment. On a preview with a strict Content Security Policy, also allow {{ origin }} there.</p>
        <AgentsCodeBlock :code="snippet" message="Tag copied" />
      </section>

      <section v-if="drop.canComment" class="space-y-3">
        <p class="label-mono">Or use the bookmarklet</p>
        <div class="rounded-lg border border-default">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-default px-4 py-3">
            <!-- A bookmarklet: dragged to the bookmarks bar, never run here. -->
            <a class="inline-flex h-8 cursor-grab items-center gap-1.5 rounded-md border border-default bg-elevated px-3 text-sm font-medium text-highlighted active:cursor-grabbing" :href="bookmarklet" @click.prevent="notify.done('Drag it to your bookmarks bar', 'Then click it on any page of the site.')">
              <UIcon name="i-ph-chat-circle" class="size-4 text-muted" />Review with Drop
            </a>
            <div class="flex gap-1" role="group" aria-label="Your browser">
              <UButton v-for="option in BROWSERS" :key="option.id" color="neutral" size="xs" :variant="browser === option.id ? 'soft' : 'ghost'" :label="option.label" :aria-pressed="browser === option.id" @click="browser = option.id" />
            </div>
          </div>
          <ol class="space-y-3 px-4 py-4 text-sm">
            <li v-for="(step, i) in steps" :key="i" class="flex gap-3">
              <span class="grid size-5 shrink-0 place-items-center rounded-full bg-elevated font-mono text-xs text-highlighted">{{ i + 1 }}</span>
              <span class="text-default">
                {{ step.text }}
                <span v-if="step.keys" class="inline-flex gap-0.5 align-middle"><UKbd v-for="key in step.keys" :key="key" :value="key" /></span>
                {{ step.after }}
              </span>
            </li>
          </ol>
        </div>
      </section>

      <section class="space-y-3">
        <p class="label-mono">Comments</p>
        <div v-if="!items.data.value.length" class="rounded-lg border border-dashed border-default px-4 py-10 text-center">
          <UIcon name="i-ph-chat-circle" class="size-6 text-dimmed" />
          <p class="mt-3 font-medium text-highlighted">Nothing sent from {{ host }} yet</p>
          <p class="mx-auto mt-1 max-w-sm text-sm text-muted">Open it here and press Comment, or use the bookmarklet on the site. Each note shows up here with its screenshot.</p>
        </div>
        <ul v-else class="grid gap-4 sm:grid-cols-2">
          <li v-for="item in items.data.value" :key="item.id" class="overflow-hidden rounded-lg border border-default" :class="resolved(item) && 'opacity-60'">
            <NuxtLink v-if="item.screenshot" class="flex h-56 items-center justify-center bg-muted p-3 transition-colors hover:bg-accented" :to="shotTo(item.screenshot)">
              <span class="relative min-w-0">
                <img :alt="`Screenshot of ${item.page ?? 'the page'}`" class="block max-h-50 w-auto max-w-full rounded-sm shadow-sm" loading="lazy" :src="item.screenshot.url">
                <span class="absolute rounded-sm border-2 border-inverted" :style="box(item)" />
              </span>
            </NuxtLink>
            <div v-else class="flex h-56 flex-col items-center justify-center gap-2 bg-muted text-sm text-muted">
              <UIcon name="i-ph-image-broken" class="size-6 text-dimmed" />
              No screenshot from this page
            </div>
            <div class="space-y-2 border-t border-default p-3">
              <ViewerCommentHeader :comment="{ ...item, resolved: resolved(item) }" />
              <p v-if="item.quote" class="truncate font-mono text-xs text-muted">{{ item.quote }}</p>
              <p class="line-clamp-3 text-sm">{{ item.body }}</p>
              <div class="flex items-center gap-3 text-xs">
                <span v-if="resolved(item)" class="text-muted">Resolved</span>
                <ULink v-if="pageLink(item.page)" class="text-muted hover:text-highlighted" external :href="pageLink(item.page)!" target="_blank">Open page</ULink>
              </div>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
