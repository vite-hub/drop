<script setup lang="ts">
// New comments: a one-line composer (Enter sends, Shift+Enter breaks). The selection stays highlighted
// in the document, so the composer doesn't repeat it. Existing comments: the thread, Figma's way. A bar with the
// number, Resolve, and a menu (Copy link, Delete); the comment and its replies; a reply box at the bottom. Both boxes
// take images: from the image button, a paste, or a drop.
import type { DropdownMenuItem } from "@nuxt/ui"
import type { CommentInput } from "#shared/schemas"
import type { DropComment, SiteReviewItem } from "#shared/types"

type PendingComment = Omit<CommentInput, "body">

const props = defineProps<{
  screenshot?: SiteReviewItem["screenshot"]
  pending?: PendingComment
  comment?: DropComment
  canManage: boolean
  canReply: boolean
  draft?: string
  draftError?: string
}>()
const emit = defineEmits<{
  submit: [body: string, files: File[]]
  cancel: []
  resolve: [id: string, resolved: boolean]
  delete: [id: string]
  reply: [id: string, body: string, files: File[]]
  deleteReply: [id: string, replyId: string]
  copyLink: [comment: DropComment]
}>()
const sharedDraft = props.pending ? injectReviewDraft()! : undefined
const composerDraft = sharedDraft ?? { body: ref(""), images: useImagePicks() }
const body = composerDraft.body
if (props.draft && !body.value) body.value = props.draft
const replying = ref(false)
const busy = computed(() => (sharedDraft ? sharedDraft.sending.value || sharedDraft.waiting.value : replying.value))
const { picks, problem, files, remove, clear, open: pickImages, paste, drop } = composerDraft.images
// Why the last send failed, under the box that sent it; editing the text clears it.
const error = ref<string | undefined>(props.draftError)
watch(body, () => (error.value = undefined))
const card = useTemplateRef<HTMLElement>("card")
const motion = usePreferredReducedMotion()
onMounted(() =>
  (card.value?.querySelector<HTMLElement>("textarea") ?? card.value?.querySelector<HTMLElement>("button"))?.focus({
    preventScroll: true,
  }),
)

function escape(event: KeyboardEvent) {
  if (!body.value.trim()) return emit("cancel")
  if (event.target instanceof HTMLElement) event.target.blur()
}

// A new comment may be only images, such as the Marker's snapshot; a reply still needs words.
const sendable = computed(() => Boolean(body.value.trim() || (props.pending && picks.value.length)))
function send() {
  if (!sendable.value || busy.value) return
  if (props.comment) replying.value = true
  if (props.comment) emit("reply", props.comment.id, body.value, files.value)
  else emit("submit", body.value, files.value)
}
defineExpose({
  fail: (reason?: string, text?: string) => {
    replying.value = false
    if (text && !body.value) body.value = text
    error.value = reason
  },
  /** A reply went through: clear the box for the next one, and show it at the bottom of the thread. */
  sent: async () => {
    replying.value = false
    body.value = ""
    clear()
    await nextTick()
    thread.value?.scrollTo({
      top: thread.value.scrollHeight,
      behavior: motion.value === "reduce" ? "instant" : "smooth",
    })
  },
})
const thread = useTemplateRef("thread")
const mayDelete = computed(() => Boolean(props.comment && (props.canManage || props.comment.mine)))
const menu = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: "Copy link",
      icon: "i-mingcute-link-line",
      onSelect: () => props.comment && emit("copyLink", props.comment),
    },
  ],
  ...(mayDelete.value
    ? [
        [
          {
            label: "Delete thread",
            icon: "i-mingcute-delete-2-line",
            color: "error" as const,
            onSelect: () => props.comment && emit("delete", props.comment.id),
          },
        ],
      ]
    : []),
])
</script>

<template>
  <div
    ref="card"
    data-comment-editor
    class="flex min-h-0 flex-1 flex-col overflow-hidden bg-default text-default"
    :class="pending && 'p-3'"
  >
    <template v-if="pending">
      <div class="mb-3 flex items-center justify-between gap-2">
        <span class="text-sm text-muted">{{
          pending.quote
            ? pending.kind === "area"
              ? "Marked"
              : "Selected text"
            : pending.kind === "image"
              ? "Selected image area"
              : "Selected area"
        }}</span>
        <UButton color="neutral" label="Remove selection" size="sm" variant="ghost" @click="emit('cancel')" />
      </div>
      <p v-if="pending.quote" class="mb-3 line-clamp-3 border-l-2 border-default pl-3 text-sm text-muted">
        {{ pending.quote }}
      </p>
      <div class="flex items-end gap-1" @dragover.prevent @drop="drop">
        <UTextarea
          v-model="body"
          aria-label="Comment"
          autofocus
          autoresize
          class="flex-1"
          :maxrows="6"
          :placeholder="
            picks.length
              ? 'Add a note (optional)'
              : pending.quote
                ? 'Comment on the selection'
                : pending.ow
                  ? 'Comment on this area'
                  : 'Comment on this spot'
          "
          :rows="1"
          :ui="{ base: 'px-1 py-1.5 text-base leading-relaxed sm:text-sm' }"
          variant="none"
          @keydown.enter.exact.prevent="send"
          @keydown.esc.stop="escape"
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
          :disabled="!sendable"
          icon="i-mingcute-arrow-up-line"
          :loading="busy"
          @click="send"
        />
      </div>
      <ViewerImagePicks class="px-1 pt-1" :picks="picks" @remove="remove" />
      <p v-if="error || problem" class="px-1 pt-1 pb-0.5 text-xs text-error" role="alert">{{ error || problem }}</p>
    </template>
    <template v-else-if="comment">
      <div class="flex h-10 shrink-0 items-center gap-1 border-b border-default pr-1.5 pl-3">
        <UButton
          aria-label="Back to comments"
          color="neutral"
          icon="i-mingcute-arrow-left-line"
          size="sm"
          variant="ghost"
          @click="emit('cancel')"
        />
        <span class="label-mono">Comment #{{ comment.n }}</span>
        <span v-if="comment.resolved" class="ml-1.5 text-xs text-muted">Resolved</span>
        <span class="flex-1" />
        <UTooltip v-if="canManage || comment.mine" :text="comment.resolved ? 'Reopen' : 'Resolve'">
          <UButton
            :aria-label="comment.resolved ? 'Reopen' : 'Resolve'"
            color="neutral"
            :icon="comment.resolved ? 'i-mingcute-back-line' : 'i-mingcute-check-circle-line'"
            size="sm"
            variant="ghost"
            @click="emit('resolve', comment.id, !comment.resolved)"
          />
        </UTooltip>
        <UDropdownMenu :content="{ align: 'end' }" :items="menu">
          <UButton aria-label="More" color="neutral" icon="i-mingcute-more-1-line" size="sm" variant="ghost" />
        </UDropdownMenu>
      </div>

      <div ref="thread" class="min-h-0 flex-1 divide-y divide-default overflow-y-auto overscroll-contain wrap-anywhere">
        <div class="space-y-2 px-3 py-3">
          <ViewerReviewScreenshot v-if="screenshot" :comment="comment" :screenshot="screenshot" />
          <ViewerCommentHeader :comment="comment" :numbered="false" />
          <p v-if="comment.quote" class="line-clamp-3 border-l-2 border-default pl-2.5 text-sm text-muted">
            {{ comment.quote }}
          </p>
          <p class="text-sm whitespace-pre-wrap">{{ comment.body }}</p>
          <ViewerCommentImages :attachments="comment.attachments" />
        </div>
        <div v-for="reply in comment.replies" :key="reply.id" class="group space-y-1.5 px-3 py-3">
          <div class="flex items-center gap-2">
            <UAvatar :alt="reply.authorName" :src="reply.authorImage ?? undefined" size="2xs" />
            <span class="text-sm font-medium text-highlighted">{{ reply.authorName }}</span>
            <span class="font-mono text-xs text-muted"><TimeAgo :at="reply.createdAt" /></span>
            <UButton
              v-if="canManage || reply.mine"
              aria-label="Delete reply"
              class="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              color="neutral"
              icon="i-mingcute-delete-2-line"
              size="xs"
              variant="ghost"
              @click="emit('deleteReply', comment.id, reply.id)"
            />
          </div>
          <p class="text-sm whitespace-pre-wrap">{{ reply.body }}</p>
          <ViewerCommentImages :attachments="reply.attachments" />
        </div>
      </div>

      <ViewerImagePicks v-if="canReply" class="border-t border-default px-2.5 pt-1.5" :picks="picks" @remove="remove" />
      <div
        v-if="canReply"
        class="flex shrink-0 items-end gap-1 p-1.5 pl-2.5"
        :class="picks.length ? '' : 'border-t border-default'"
        @dragover.prevent
        @drop="drop"
      >
        <UTextarea
          v-model="body"
          aria-label="Reply"
          autofocus
          autoresize
          class="flex-1"
          :maxrows="6"
          placeholder="Reply"
          :rows="1"
          :ui="{ base: 'px-1 py-1.5 text-base leading-relaxed sm:text-sm' }"
          variant="none"
          @keydown.enter.exact.prevent="send"
          @keydown.esc.stop="escape"
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
          aria-label="Send reply"
          class="size-8 justify-center rounded-full"
          color="neutral"
          :disabled="!body.trim()"
          icon="i-mingcute-arrow-up-line"
          :loading="busy"
          @click="send"
        />
      </div>
      <p v-if="canReply && (error || problem)" class="px-3 pb-2 text-xs text-error" role="alert">
        {{ error || problem }}
      </p>
    </template>
  </div>
</template>
