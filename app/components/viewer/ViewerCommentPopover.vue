<script setup lang="ts">
// New comments: a one-line composer (Enter sends, Shift+Enter breaks). The selection stays highlighted
// in the document, so the composer doesn't repeat it. Existing comments: the thread, Figma's way. A bar with the
// number, Resolve, and a menu (Copy link, Delete); the comment and its replies; a reply box at the bottom.
// Sending is optimistic: a new comment closes the box and shows its pin at once, a reply shows in the thread at once.
// If the server refuses, the text comes back to its box (`draft` for a new comment, `fail` for a reply) with why.
import type { DropdownMenuItem } from "@nuxt/ui"
import type { CommentInput } from "#shared/schemas"
import type { DropComment } from "#shared/types"

type PendingComment = Omit<CommentInput, "body">

const props = defineProps<{
  x: number
  y: number
  pending?: PendingComment
  comment?: DropComment
  canManage: boolean
  canReply: boolean
  /** A new comment's text that didn't go through, and why. */
  draft?: string
  draftError?: string
}>()
const emit = defineEmits<{
  submit: [body: string]
  cancel: []
  resolve: [id: string, resolved: boolean]
  delete: [id: string]
  reply: [id: string, body: string]
  deleteReply: [id: string, replyId: string]
  copyLink: [comment: DropComment]
}>()
const body = ref(props.draft ?? "")
// Why the last send failed, under the box that sent it; editing the text clears it.
const error = ref<string | undefined>(props.draftError)
watch(body, () => (error.value = undefined))
const viewport = useWindowSize()
const card = useTemplateRef("card")
const { height } = useElementSize(card)
const width = computed(() => Math.min(props.comment ? 352 : 320, Math.max(0, viewport.width.value - 16)))
// Below the pin when it fits, else as high as the thread needs; never under the header or off the bottom.
const style = computed(() => {
  const left = Math.min(Math.max(8, props.x), Math.max(8, viewport.width.value - width.value - 8))
  const top = Math.max(56, Math.min(props.y + 8, viewport.height.value - Math.max(height.value, 120) - 8))
  return { left: `${left}px`, top: `${top}px`, width: `${width.value}px` }
})

async function send() {
  const text = body.value
  if (!text.trim()) return
  if (!props.comment) return emit("submit", text)
  emit("reply", props.comment.id, text)
  // The reply is in the thread already: clear the box for the next one and show it at the bottom.
  body.value = ""
  await nextTick()
  thread.value?.scrollTo({ top: thread.value.scrollHeight, behavior: "smooth" })
}
defineExpose({
  /** A reply didn't go through: its text comes back, unless a new one was typed meanwhile. */
  fail: async (reason?: string, text?: string) => {
    if (text && !body.value) body.value = text
    await nextTick()
    error.value = reason
  },
})
const thread = useTemplateRef("thread")
// Until the server has it, a new comment can't be resolved, deleted, or replied to.
const posting = computed(() => Boolean(props.comment && isPending(props.comment.id)))
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
  <div class="fixed inset-0 z-40" @click="emit('cancel')" />
  <div
    ref="card"
    class="fixed z-50 flex origin-top-left flex-col overflow-hidden rounded-xl border border-default bg-default text-default shadow-lg shadow-black/5 [animation:pop-in_160ms_var(--ease-out)]"
    :class="pending ? 'p-1.5 pl-2.5' : 'max-h-[min(32rem,calc(100dvh-4.5rem))]'"
    :style="style"
  >
    <template v-if="pending">
      <div class="flex items-end gap-2">
        <UTextarea
          v-model="body"
          aria-label="Comment"
          autofocus
          autoresize
          class="flex-1"
          :maxrows="6"
          :placeholder="
            pending.quote ? 'Comment on the selection' : pending.ow ? 'Comment on this area' : 'Comment on this spot'
          "
          :rows="1"
          :ui="{ base: 'px-1 py-1.5 text-sm leading-relaxed' }"
          variant="none"
          @keydown.enter.exact.prevent="send"
          @keydown.esc.stop="emit('cancel')"
        />
        <UButton
          aria-label="Send comment"
          class="size-8 justify-center rounded-full"
          color="neutral"
          :disabled="!body.trim()"
          icon="i-mingcute-arrow-up-line"
          @click="send"
        />
      </div>
      <p v-if="error" class="px-1 pt-1 pb-0.5 text-xs text-error" role="alert">{{ error }}</p>
    </template>
    <template v-else-if="comment">
      <div class="flex h-10 shrink-0 items-center gap-1 border-b border-default pr-1.5 pl-3">
        <span class="label-mono">Comment #{{ comment.n }}</span>
        <span v-if="comment.resolved" class="ml-1.5 text-xs text-muted">Resolved</span>
        <span v-if="posting" class="ml-1.5 text-xs text-muted">Posting</span>
        <span class="flex-1" />
        <UTooltip v-if="!posting && (canManage || comment.mine)" :text="comment.resolved ? 'Reopen' : 'Resolve'">
          <UButton
            :aria-label="comment.resolved ? 'Reopen' : 'Resolve'"
            color="neutral"
            :icon="comment.resolved ? 'i-mingcute-back-line' : 'i-mingcute-check-circle-line'"
            size="sm"
            variant="ghost"
            @click="emit('resolve', comment.id, !comment.resolved)"
          />
        </UTooltip>
        <UDropdownMenu v-if="!posting" :content="{ align: 'end' }" :items="menu">
          <UButton aria-label="More" color="neutral" icon="i-mingcute-more-1-line" size="sm" variant="ghost" />
        </UDropdownMenu>
        <UButton
          aria-label="Close"
          color="neutral"
          icon="i-mingcute-close-line"
          size="sm"
          variant="ghost"
          @click="emit('cancel')"
        />
      </div>

      <div ref="thread" class="min-h-0 flex-1 divide-y divide-default overflow-y-auto">
        <div class="space-y-2 px-3 py-3">
          <ViewerCommentHeader :comment="comment" :numbered="false" />
          <p v-if="comment.quote" class="line-clamp-3 border-l-2 border-default pl-2.5 text-sm text-muted">
            {{ comment.quote }}
          </p>
          <p class="text-sm whitespace-pre-wrap">{{ comment.body }}</p>
        </div>
        <div
          v-for="reply in comment.replies"
          :key="reply.id"
          class="group space-y-1.5 px-3 py-3 transition-opacity"
          :class="isPending(reply.id) && 'opacity-60'"
        >
          <div class="flex items-center gap-2">
            <UAvatar :alt="reply.authorName" :src="reply.authorImage ?? undefined" size="2xs" />
            <span class="text-sm font-medium text-highlighted">{{ reply.authorName }}</span>
            <span class="font-mono text-xs text-muted"><TimeAgo :at="reply.createdAt" /></span>
            <UButton
              v-if="!isPending(reply.id) && (canManage || reply.mine)"
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
        </div>
      </div>

      <div v-if="canReply && !posting" class="flex shrink-0 items-end gap-2 border-t border-default p-1.5 pl-2.5">
        <UTextarea
          v-model="body"
          aria-label="Reply"
          autofocus
          autoresize
          class="flex-1"
          :maxrows="6"
          placeholder="Reply"
          :rows="1"
          :ui="{ base: 'px-1 py-1.5 text-sm leading-relaxed' }"
          variant="none"
          @keydown.enter.exact.prevent="send"
          @keydown.esc.stop="emit('cancel')"
        />
        <UButton
          aria-label="Send reply"
          class="size-8 justify-center rounded-full"
          color="neutral"
          :disabled="!body.trim()"
          icon="i-mingcute-arrow-up-line"
          @click="send"
        />
      </div>
      <p v-if="canReply && error" class="px-3 pb-2 text-xs text-error" role="alert">{{ error }}</p>
    </template>
  </div>
</template>
