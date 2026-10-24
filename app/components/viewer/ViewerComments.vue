<script setup lang="ts">
import type { DropComment, DropVersion } from "#shared/types"
import type { Sent } from "~/composables/useDrop"

// `addPageComment` posts a comment on the page as a whole, written in the box at the bottom; the box only clears once it
// went through, and says why under it when it didn't. `focus` carries the row's box for those comments, which have no pin to open at.
const props = defineProps<{
  comments: DropComment[]
  canComment: boolean
  canManage: boolean
  version: number
  versions: DropVersion[]
  outdated: Set<string>
  addPageComment: (body: string, files: File[]) => Promise<Sent<DropComment>>
}>()
const emit = defineEmits<{ focus: [comment: DropComment, row: DOMRect]; resolve: [id: string, resolved: boolean] }>()
const filter = ref<"open" | "resolved">("open")
const tabs = computed(() => [
  { label: "Open", value: "open", badge: props.comments.filter((comment) => !comment.resolved).length },
  { label: "Resolved", value: "resolved", badge: props.comments.filter((comment) => comment.resolved).length },
])
const visible = computed(() =>
  props.comments.filter((comment) =>
    filter.value === "open" ? !comment.resolved && !props.outdated.has(comment.id) : comment.resolved,
  ),
)
// Open comments from an earlier version whose text or element this version no longer has. They stay open (the doc
// changed, the point may still stand) but sit apart, each with a link to the version it was written on.
const earlier = computed(() =>
  filter.value === "open"
    ? props.comments.filter((comment) => !comment.resolved && props.outdated.has(comment.id))
    : [],
)
const versionOf = (version: number) => props.versions.find((item) => item.version === version)
const versionTo = useVersionTo()
/** Who replied, once each, latest first. */
const repliers = (comment: DropComment) => [
  ...new Map(comment.replies.toReversed().map((reply) => [reply.authorName, reply])).values(),
]

const pageBody = ref("")
const sending = ref(false)
const pageError = ref<string>()
watch(pageBody, () => (pageError.value = undefined))
const { picks, problem, files, remove, clear, open: pickImages, paste, drop } = useImagePicks()
async function sendPageComment() {
  if (!pageBody.value.trim() || sending.value) return
  sending.value = true
  const sent = await props.addPageComment(pageBody.value, files.value)
  if ("value" in sent) {
    pageBody.value = ""
    clear()
    filter.value = "open"
  } else pageError.value = sent.error
  sending.value = false
}
</script>

<template>
  <div class="flex h-full flex-col">
    <UTabs
      v-model="filter"
      class="shrink-0 px-4"
      color="neutral"
      :content="false"
      :items="tabs"
      size="sm"
      variant="link"
    />
    <ul class="min-h-0 flex-1 divide-y divide-default overflow-y-auto border-t border-default">
      <li v-if="!visible.length && !earlier.length" class="px-4 py-10 text-center text-sm text-muted">
        {{
          filter === "resolved"
            ? "Nothing resolved yet."
            : canComment
              ? "Select text, click an image, or press R to comment on an area. For the page as a whole, write below."
              : "No comments yet."
        }}
      </li>
      <li v-for="comment in visible" :key="comment.id" class="space-y-2 px-4 py-3">
        <button
          class="w-full cursor-pointer space-y-2 text-left"
          type="button"
          @click="emit('focus', comment, ($event.currentTarget as HTMLElement).getBoundingClientRect())"
        >
          <ViewerCommentHeader :comment="comment" :current="version" />
          <p v-if="comment.kind === 'page'" class="flex items-center gap-1.5 text-xs text-muted">
            <UIcon name="i-mingcute-web-line" class="size-3.5" />Whole page
          </p>
          <p v-else-if="comment.quote" class="line-clamp-3 border-l-2 border-default pl-2.5 text-sm text-muted">
            {{ comment.quote }}
          </p>
          <p class="text-sm">{{ comment.body }}</p>
          <ViewerCommentImages :attachments="comment.attachments" />
          <span v-if="comment.replies.length" class="flex items-center gap-1.5 text-xs text-muted">
            <UAvatarGroup :max="3" size="2xs">
              <UAvatar
                v-for="reply in repliers(comment)"
                :key="reply.authorName"
                :alt="reply.authorName"
                :src="reply.authorImage ?? undefined"
              />
            </UAvatarGroup>
            {{ comment.replies.length === 1 ? "1 reply" : `${comment.replies.length} replies` }}
          </span>
        </button>
        <button
          v-if="canManage || comment.mine"
          class="cursor-pointer text-xs text-muted hover:text-highlighted"
          type="button"
          @click="emit('resolve', comment.id, !comment.resolved)"
        >
          {{ comment.resolved ? "Reopen" : "Resolve" }}
        </button>
      </li>
      <li v-if="earlier.length" class="bg-elevated/50 px-4 py-2">
        <p class="label-mono">From earlier versions</p>
        <p class="mt-0.5 text-xs text-muted">What these point at changed or is gone in v{{ version }}.</p>
      </li>
      <li v-for="comment in earlier" :key="comment.id" class="space-y-2 px-4 py-3">
        <ViewerCommentHeader :comment="comment" :current="version" />
        <p
          v-if="comment.quote"
          class="line-clamp-3 border-l-2 border-dashed border-default pl-2.5 text-sm text-dimmed line-through decoration-(--ui-border-accented)"
        >
          {{ comment.quote }}
        </p>
        <p class="text-sm">{{ comment.body }}</p>
        <div class="flex items-center gap-3 text-xs">
          <NuxtLink
            v-if="versionOf(comment.version)"
            class="text-muted hover:text-highlighted"
            :to="versionTo(versionOf(comment.version)!)"
            >See it on v{{ comment.version }}</NuxtLink
          >
          <button
            v-if="canManage || comment.mine"
            class="cursor-pointer text-muted hover:text-highlighted"
            type="button"
            @click="emit('resolve', comment.id, true)"
          >
            Resolve
          </button>
        </div>
      </li>
    </ul>
    <!-- A comment on the page as a whole: no text, image, or area to point at. Enter sends, Shift+Enter breaks. -->
    <ViewerImagePicks v-if="canComment" class="border-t border-default px-2.5 pt-1.5" :picks="picks" @remove="remove" />
    <div
      v-if="canComment"
      class="flex shrink-0 items-end gap-1 p-1.5 pl-2.5"
      :class="picks.length ? '' : 'border-t border-default'"
      @dragover.prevent
      @drop="drop"
    >
      <UTextarea
        v-model="pageBody"
        aria-label="Comment on the whole page"
        autoresize
        class="flex-1"
        :maxrows="6"
        placeholder="Comment on the whole page"
        :rows="1"
        :ui="{ base: 'px-1 py-1.5 text-sm leading-relaxed' }"
        variant="none"
        @keydown.enter.exact.prevent="sendPageComment"
        @paste="paste"
      />
      <UTooltip text="Add images">
        <UButton
          aria-label="Add images"
          class="size-8 justify-center rounded-full"
          color="neutral"
          icon="i-mingcute-pic-line"
          variant="ghost"
          @click="pickImages"
        />
      </UTooltip>
      <UButton
        aria-label="Send comment"
        class="size-8 justify-center rounded-full"
        color="neutral"
        :disabled="!pageBody.trim()"
        icon="i-mingcute-arrow-up-line"
        :loading="sending"
        @click="sendPageComment"
      />
    </div>
    <p v-if="canComment && (pageError || problem)" class="shrink-0 px-3 pb-2 text-xs text-error" role="alert">
      {{ pageError || problem }}
    </p>
  </div>
</template>
