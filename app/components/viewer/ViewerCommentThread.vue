<script setup lang="ts">
// A new comment, or the open thread, with vite-hub/ui's comment parts. A new comment is a CommentComposer: Enter sends,
// Shift+Enter breaks, "@" names people who may read the drop, and images come from the button, a paste, or a drop,
// beside the ones the viewer took (the Marker's snapshot, the area's picture). Suggest on a selection adds the words
// that replace it above the note (`#extra`). The open thread is a CommentThread: the quote or the suggestion's redline
// in `#anchor`, Accept and the thread's menu in `#actions`, a site's screenshot in `#after`.
import type { DropdownMenuItem } from "@nuxt/ui"
import { CommentComposer, type CommentComposerSubmit, CommentThread } from "vite-hub/ui/comments"
import { COMMENT_IMAGE_TYPES, type CommentInput } from "#shared/schemas"
import type { DropComment, SiteReviewItem } from "#shared/types"

type PendingComment = Omit<CommentInput, "body" | "mentions">

const props = defineProps<{
  screenshot?: SiteReviewItem["screenshot"]
  pending?: PendingComment
  comment?: DropComment
  /** Whether this reader may put a suggestion's words into the doc (an editor, on its latest version). */
  canAccept?: boolean
  accepting?: boolean
  /** The version on show, so a comment from an earlier one says so. */
  version?: number
  draft?: string
  draftError?: string
  /** The thread floats beside its pin or over its card in the margin: it closes, rather than going back to the list. */
  floating?: boolean
}>()
const emit = defineEmits<{
  submit: [body: string, files: File[], mentions: string[]]
  cancel: []
  resolve: [id: string, resolved: boolean]
  delete: [id: string]
  deleteReply: [id: string, replyId: string]
  copyLink: [comment: DropComment]
  /** The suggested words were edited; the viewer keeps them on the pending comment, which sends them. */
  suggest: [text: string]
  accept: [id: string]
}>()
const dropComments = injectDropComments()!
const { user, people, attachmentUrl, can } = dropComments
const accept = COMMENT_IMAGE_TYPES.join(",")

// A new comment keeps its words and images in the viewer's draft while areas come and go.
const draft = props.pending ? injectReviewDraft()! : undefined
const body = draft?.body ?? ref("")
if (props.draft && !body.value) body.value = props.draft
const mentions = ref<string[]>([])
const error = ref<string | undefined>(props.draftError)
watch(body, () => (error.value = undefined))
const busy = computed(() => Boolean(draft && (draft.sending.value || draft.waiting.value)))
// The composer's files are the draft's picks, so the viewer's own pictures show and go with the rest.
const files = computed({
  get: () => draft?.images.files.value ?? [],
  set: (next: File[]) => {
    if (!draft) return
    const { images } = draft
    for (const pick of images.picks.value) if (!next.includes(pick.file)) images.remove(pick)
    const added = next.filter((file) => !images.files.value.includes(file))
    if (added.length) images.add(added)
  },
})
const problem = computed(() => draft?.images.problem.value)

// A suggested edit on the selection: the words that replace it, empty to delete it.
const suggesting = computed(() => props.pending?.suggestion !== undefined)
const suggestion = computed({
  get: () => props.pending?.suggestion ?? "",
  set: (text: string) => emit("suggest", text),
})
const card = useTemplateRef<HTMLElement>("card")
onMounted(() => {
  // A suggestion starts as the selected words, selected, so typing replaces them.
  const field = card.value?.querySelector<HTMLTextAreaElement>(
    suggesting.value ? "[data-suggestion] textarea" : "textarea",
  )
  field?.focus({ preventScroll: true })
  if (suggesting.value) field?.select()
})

function send(submit?: CommentComposerSubmit) {
  if (busy.value) return
  const text = submit?.body ?? body.value
  const changed = suggesting.value && suggestion.value !== props.pending?.quote
  if (!text.trim() && !files.value.length && !changed) return
  emit("submit", text, submit?.files ?? files.value, submit?.mentions ?? mentions.value)
}
function escapeSuggestion(event: KeyboardEvent) {
  if (!body.value.trim() && suggestion.value === props.pending?.quote) return emit("cancel")
  if (event.target instanceof HTMLElement) event.target.blur()
}
defineExpose({
  fail: async (reason?: string, text?: string) => {
    if (text && !body.value) body.value = text
    error.value = reason
  },
})

const thread = computed(() => (props.comment ? dropComments.thread(props.comment) : undefined))
const versionTo = useVersionTo()
const state = injectDrop()!
const earlier = computed(() =>
  props.comment && props.version && props.comment.version < props.version
    ? state.drop.data.value?.versions.find((item) => item.version === props.comment!.version)
    : undefined,
)
const mayDelete = computed(() =>
  Boolean(thread.value && can("delete", { thread: thread.value, message: thread.value.messages[0] })),
)
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
// Deleting the comment itself deletes its thread; the viewer then closes it.
function remove(messageId: string) {
  const comment = props.comment
  if (!comment) return
  if (messageId === comment.messageId) emit("delete", comment.id)
  else return state.removeReply(comment.id, messageId)
}
const reply = (text: string, ids: string[], attached: File[]) =>
  props.comment && dropComments.reply(props.comment.id, text, ids, attached)
const edit = (messageId: string, text: string, ids: string[]) =>
  props.comment && dropComments.edit(props.comment.id, messageId, text, ids)
</script>

<template>
  <div
    ref="card"
    data-comment-editor
    class="drop-comment-card flex min-h-0 flex-1 flex-col overflow-hidden bg-default text-default"
    :class="pending && 'p-2 in-[#drop-comments]:p-3'"
  >
    <template v-if="pending">
      <!-- Only in the dock: the card floating over the page sits beside what it's on, which stays marked there. -->
      <div class="mb-3 hidden items-center justify-between gap-2 in-[#drop-comments]:flex">
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
      <p
        v-if="pending.quote && !suggesting"
        class="mb-3 line-clamp-3 hidden border-l-2 border-default pl-3 text-sm text-muted in-[#drop-comments]:[display:-webkit-box]"
      >
        {{ pending.quote }}
      </p>
      <CommentComposer
        v-model="body"
        v-model:files="files"
        v-model:mentions="mentions"
        :accept="accept"
        allow-empty
        :autofocus="false"
        :busy="busy"
        :error="error || problem"
        :guard="false"
        layout="row"
        :placeholder="
          files.length || suggesting
            ? 'Add a note (optional)'
            : pending.quote
              ? 'Add a comment'
              : pending.ow
                ? 'Comment on this area'
                : 'Comment on this spot'
        "
        :user="user"
        :users="dropComments.users"
        @cancel="emit('cancel')"
        @submit="send"
      >
        <template v-if="suggesting" #extra>
          <!-- Left edges line up with the note's text: the struck quote, the field, and the note. -->
          <div data-suggestion class="space-y-1 pt-0.5">
            <p class="line-clamp-3 text-sm leading-relaxed">
              <span class="sr-only">Replace </span><del class="redline-del px-1">{{ pending.quote }}</del>
            </p>
            <div class="flex items-end gap-1">
              <UTextarea
                v-model="suggestion"
                aria-label="Suggested text"
                autoresize
                class="min-w-0 flex-1"
                :maxrows="6"
                placeholder="Leave empty to delete it"
                :rows="1"
                :ui="{
                  base: 'redline-ins rounded-sm px-1 py-1 text-base leading-relaxed placeholder:text-muted sm:text-sm',
                }"
                variant="none"
                @keydown.enter.exact.prevent="send()"
                @keydown.esc.stop="escapeSuggestion"
              />
              <UButton
                aria-label="Send suggestion"
                color="neutral"
                :disabled="suggestion === pending.quote && !body.trim()"
                icon="i-mingcute-arrow-up-line"
                :loading="busy"
                size="sm"
                variant="ghost"
                @click="send()"
              />
            </div>
          </div>
        </template>
      </CommentComposer>
    </template>
    <CommentThread
      v-else-if="comment && thread"
      :accept="accept"
      :attachment-url="attachmentUrl"
      :can="can"
      :dismissible="false"
      :navigation="floating ? 'close' : 'back'"
      :people="people"
      :on-delete="remove"
      :on-edit="edit"
      :on-reopen="() => emit('resolve', comment!.id, false)"
      :on-reply="reply"
      :on-resolve="() => emit('resolve', comment!.id, true)"
      :thread="thread"
      :user="user"
      :users="dropComments.users"
      @close="emit('cancel')"
    >
      <template #actions>
        <UTooltip
          v-if="canAccept && comment.suggestion !== null && !comment.resolved"
          text="Publish a new version with this change"
        >
          <UButton
            color="neutral"
            icon="i-mingcute-check-line"
            label="Accept"
            :loading="accepting"
            size="xs"
            variant="soft"
            @click="emit('accept', comment.id)"
          />
        </UTooltip>
        <UDropdownMenu :content="{ align: 'end' }" :items="menu">
          <UButton aria-label="More" color="neutral" icon="i-mingcute-more-1-fill" size="xs" variant="ghost" />
        </UDropdownMenu>
      </template>
      <template #anchor>
        <div class="space-y-2 px-3 pt-3 empty:hidden">
          <p v-if="earlier" class="text-xs text-muted">
            Written on
            <NuxtLink class="underline hover:text-highlighted" :to="versionTo(earlier)">v{{ earlier.version }}</NuxtLink
            >. What it points at may have changed since.
          </p>
          <p v-if="comment.kind === 'page'" class="flex items-center gap-1.5 text-xs text-muted">
            <UIcon name="i-mingcute-chat-3-line" class="size-3.5" />General feedback
          </p>
          <ViewerSuggestion
            v-else-if="comment.quote && comment.suggestion !== null"
            :quote="comment.quote"
            :suggestion="comment.suggestion"
          />
          <p v-else-if="comment.quote" class="line-clamp-3 border-l-2 border-default pl-2.5 text-sm text-muted">
            {{ comment.quote }}
          </p>
        </div>
      </template>
      <template v-if="screenshot" #after>
        <ViewerReviewScreenshot :comment="comment" :screenshot="screenshot" />
      </template>
    </CommentThread>
  </div>
</template>

<style scoped>
/* The thread fills the dock or the card: its messages scroll, its reply box stays at the bottom. */
.drop-comment-card :deep([data-slot="comment-thread"]) {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}

.drop-comment-card :deep([data-slot="comment-thread-messages"]) {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  overflow-wrap: anywhere;
}
</style>
