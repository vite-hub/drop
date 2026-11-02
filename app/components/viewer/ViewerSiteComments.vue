<script setup lang="ts">
// A site drop's comments as the page's main content: each one a card led by its screenshot, newest first. A card opens
// its thread in the review dock; "Review this page" opens the page it was written on in the frame.
import type { DropComment, SiteReviewItem } from "#shared/types"

const props = defineProps<{
  comments: DropComment[]
  screenshots: Map<string, SiteReviewItem["screenshot"]>
  canManage: boolean
  /** Whether the site is a pattern, so each comment names the preview it came from. */
  pattern: boolean
  /** The page's full address, when the frame can open it. */
  pageUrl: (comment: DropComment) => string | undefined
}>()
const emit = defineEmits<{
  focus: [comment: DropComment]
  resolve: [id: string, resolved: boolean]
  review: [url: string]
}>()

const filter = ref<"open" | "resolved">("open")
const openCount = computed(() => props.comments.filter((comment) => !comment.resolved).length)
const resolvedCount = computed(() => props.comments.length - openCount.value)
watch(resolvedCount, (count) => {
  if (!count) filter.value = "open"
})
const tabs = computed(() => [
  { label: "Open", value: "open", badge: openCount.value },
  { label: "Resolved", value: "resolved", badge: resolvedCount.value },
])
const visible = computed(() =>
  props.comments
    .filter((comment) => comment.resolved === (filter.value === "resolved"))
    .toSorted((a, b) => b.createdAt - a.createdAt),
)
// Where a comment was written, short enough for the card: the path, after the preview's name on a pattern.
function pageLabel(comment: DropComment) {
  const page = comment.page
  if (!page || !URL.canParse(page)) return page ?? ""
  const url = new URL(page)
  return props.pattern ? `${url.hostname.split(".")[0]} ${url.pathname}` : url.pathname
}
</script>

<template>
  <section class="space-y-4" aria-labelledby="site-comments-heading">
    <div class="flex min-h-8 items-center justify-between gap-4">
      <h2 id="site-comments-heading" class="text-sm font-medium text-highlighted">
        Comments
        <span v-if="openCount" class="ml-1 font-mono text-xs font-normal text-muted">{{ openCount }} open</span>
      </h2>
      <UTabs
        v-if="resolvedCount"
        v-model="filter"
        color="neutral"
        :content="false"
        :items="tabs"
        size="xs"
        variant="pill"
      />
    </div>
    <p
      v-if="!visible.length"
      class="rounded-lg border border-dashed border-default px-6 py-10 text-center text-sm text-pretty text-muted"
    >
      {{
        filter === "resolved"
          ? "Nothing resolved yet."
          : comments.length
            ? "Every comment is resolved."
            : "No comments yet. Open the site above and drag over anything to comment on it."
      }}
    </p>
    <TransitionGroup
      v-else
      :key="filter"
      class="grid gap-3 sm:grid-cols-2"
      enter-active-class="motion-safe:transition-[opacity,translate] motion-safe:duration-200 motion-safe:ease-(--ease-out)"
      enter-from-class="opacity-0 translate-y-1"
      tag="ul"
    >
      <li
        v-for="comment in visible"
        :key="comment.id"
        class="group/card relative flex flex-col overflow-hidden rounded-lg border border-default bg-default transition-[border-color,box-shadow] duration-150 ease-(--ease-out) has-[[data-comment-id]:focus-visible]:ring-2 has-[[data-comment-id]:focus-visible]:ring-inverted pointer-fine:hover:border-accented pointer-fine:hover:shadow-sm"
      >
        <figure
          v-if="screenshots.get(comment.id)"
          class="flex h-40 items-center justify-center border-b border-default bg-muted p-3"
        >
          <span class="relative block">
            <img
              :src="screenshots.get(comment.id)!.url"
              :alt="`Screenshot of ${comment.page || 'the reviewed page'}`"
              class="block max-h-34 max-w-full rounded-sm object-contain outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
              loading="lazy"
            />
            <span
              v-if="comment.ow || comment.oh"
              aria-hidden="true"
              class="pointer-events-none absolute rounded-sm border-2 border-neutral-950 shadow-[0_0_0_2px_rgb(255_255_255_/_0.85)]"
              :style="{
                left: `${comment.ox / 10}%`,
                top: `${comment.oy / 10}%`,
                width: `${comment.ow / 10}%`,
                height: `${comment.oh / 10}%`,
              }"
            />
          </span>
        </figure>
        <div class="flex flex-1 flex-col gap-2 p-3">
          <!-- The whole card opens the thread; the button's area covers it, under the links and actions. -->
          <button
            :data-comment-id="comment.id"
            class="cursor-pointer text-left outline-none before:absolute before:inset-0"
            type="button"
            @click="emit('focus', comment)"
          >
            <span class="flex min-w-0 items-center gap-2">
              <UAvatar :alt="comment.authorName" :src="comment.authorImage ?? undefined" size="2xs" />
              <span class="truncate text-sm font-medium text-highlighted">{{ comment.authorName }}</span>
              <span class="shrink-0 font-mono text-xs text-muted"
                >#{{ comment.n }} · <TimeAgo :at="comment.createdAt"
              /></span>
            </span>
          </button>
          <p v-if="comment.quote" class="line-clamp-2 border-l-2 border-default pl-2.5 text-sm text-muted">
            {{ comment.quote }}
          </p>
          <p v-if="comment.body" class="line-clamp-4 text-sm text-pretty wrap-anywhere">{{ comment.body }}</p>
          <div class="relative mt-auto flex items-center gap-3 pt-1 text-xs text-muted">
            <span
              v-if="comment.page"
              class="min-w-0 truncate font-mono text-[11px] text-dimmed"
              :title="comment.page"
              >{{ pageLabel(comment) }}</span
            >
            <span v-if="comment.replies.length" class="flex shrink-0 items-center gap-1">
              <UIcon name="i-mingcute-chat-3-line" class="size-3.5" />{{ comment.replies.length }}
            </span>
            <span class="ml-auto flex shrink-0 items-center gap-3">
              <button
                v-if="pageUrl(comment)"
                class="min-h-6 cursor-pointer hover:text-highlighted pointer-coarse:min-h-11"
                type="button"
                @click="emit('review', pageUrl(comment)!)"
              >
                Review this page
              </button>
              <button
                v-if="canManage || comment.mine"
                class="min-h-6 cursor-pointer hover:text-highlighted pointer-coarse:min-h-11"
                type="button"
                @click="emit('resolve', comment.id, !comment.resolved)"
              >
                {{ comment.resolved ? "Reopen" : "Resolve" }}
              </button>
            </span>
          </div>
        </div>
      </li>
    </TransitionGroup>
  </section>
</template>
