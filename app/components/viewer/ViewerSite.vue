<script setup lang="ts">
// A site drop's page: the website under review, the tag that adds the review to it, and what people sent from its
// pages, newest first. Each screenshot opens as its own image, where the box shows and the thread continues.
import { dropPath } from "#shared/links"
import { reviewSnippet } from "#shared/review"
import type { DropDetail, SiteReviewItem } from "#shared/types"

/** `inset`: room to leave on the right for the floating panel, in pixels. */
const props = defineProps<{ drop: DropDetail; publicView: boolean; inset: number }>()

const state = injectDrop()!
const items = useApi<SiteReviewItem[]>(() => `/api/drops/${props.drop.id}/review`, { key: () => `review:${props.drop.id}`, default: () => [] })
const origin = useRequestURL().origin
const snippet = computed(() => reviewSnippet(origin, props.drop.link))
const host = computed(() => (props.drop.siteUrl ? new URL(props.drop.siteUrl).host : ""))
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
          <UButton v-if="drop.siteUrl" color="neutral" external icon="i-ph-arrow-square-out" label="Open site" target="_blank" :to="drop.siteUrl" variant="outline" />
        </div>
        <template v-if="drop.isOwner">
          <p class="text-sm text-muted">Add this tag to the site's preview builds, never production. People who can comment here press Comment on any page, drag over what they mean, and their note arrives below with a screenshot.</p>
          <AgentsCodeBlock :code="snippet" message="Tag copied" />
        </template>
        <p v-else-if="drop.canComment" class="text-sm text-muted">Open the site and press Comment in its corner. Drag over what you mean, write your note, and it lands here with a screenshot.</p>
      </section>

      <section class="space-y-3">
        <p class="label-mono">Comments</p>
        <p v-if="!items.data.value.length" class="rounded-lg border border-dashed border-default px-4 py-10 text-center text-sm text-muted">
          Nothing sent from {{ host }} yet.
        </p>
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
                <ULink v-if="drop.siteUrl && item.page" class="text-muted hover:text-highlighted" external :href="drop.siteUrl + item.page" target="_blank">Open page</ULink>
              </div>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
