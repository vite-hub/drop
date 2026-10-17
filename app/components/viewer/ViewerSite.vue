<script setup lang="ts">
// A site drop's page: the website under review, the bookmarklet and the optional tag that add the review to it, and
// what people sent from its pages, newest first. Each screenshot opens as its own image, where the box shows and the
// thread continues.
import { dropPath } from "#shared/links"
import { isSitePattern, reviewBookmarklet, reviewSnippet, siteHost } from "#shared/review"
import type { DropDetail, SiteReviewItem } from "#shared/types"

/** `inset`: room to leave on the right for the floating panel, in pixels. */
const props = defineProps<{ drop: DropDetail; publicView: boolean; inset: number }>()

const state = injectDrop()!
const items = useApi<SiteReviewItem[]>(() => `/api/drops/${props.drop.id}/review`, { key: () => `review:${props.drop.id}`, default: () => [] })
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
const box = (item: SiteReviewItem) => ({ left: `${item.ox / 10}%`, top: `${item.oy / 10}%`, width: `${item.ow / 10}%`, height: `${item.oh / 10}%` })
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto">
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
        <p class="label-mono">Review the site</p>
        <div class="flex flex-wrap items-center gap-3">
          <!-- A bookmarklet: dragged to the bookmarks bar, never run here. -->
          <a class="inline-flex h-8 cursor-grab items-center gap-1.5 rounded-md border border-default bg-elevated px-3 text-sm font-medium text-highlighted active:cursor-grabbing" :href="bookmarklet" @click.prevent="notify.done('Drag it to your bookmarks bar', 'Then click it on any page of the site.')">
            <UIcon name="i-ph-chat-circle" class="size-4 text-muted" />Review with Drop
          </a>
          <p class="min-w-0 flex-1 text-sm text-muted">Drag this to your bookmarks bar. On any page of {{ host }}, click it, press Comment, and drag over what you mean. Your note lands here with a screenshot.</p>
        </div>
        <template v-if="drop.isOwner">
          <p class="text-sm text-muted">Or show the Comment button to everyone on the preview: add this tag to preview builds, never production. It carries no key: people still need this review shared with them to comment. A page with a strict Content Security Policy may block the bookmarklet; there, use the tag and allow {{ origin }} in the preview's policy.</p>
          <AgentsCodeBlock :code="snippet" message="Tag copied" />
        </template>
      </section>

      <section class="space-y-3">
        <p class="label-mono">Comments</p>
        <div v-if="!items.data.value.length" class="rounded-lg border border-dashed border-default px-4 py-10 text-center">
          <UIcon name="i-ph-chat-circle" class="size-6 text-dimmed" />
          <p class="mt-3 font-medium text-highlighted">Nothing sent from {{ host }} yet</p>
          <p class="mx-auto mt-1 max-w-sm text-sm text-muted">Open the site, click Review with Drop, and drag over what you mean. Each note shows up here with its screenshot.</p>
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
