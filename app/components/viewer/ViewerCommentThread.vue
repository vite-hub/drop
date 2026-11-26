<script setup lang="ts">
import { CommentComposer, type CommentComposerSubmit, CommentThread } from "vite-hub/ui"
import { COMMENT_IMAGE_TYPES, type CommentInput } from "#shared/schemas"
import type { DropComment, SiteReviewItem } from "#shared/types"

type PendingComment = Omit<CommentInput, "body" | "mentions">

const props = defineProps<{
  screenshot?: SiteReviewItem["screenshot"]
  pending?: PendingComment
  comment?: DropComment
  canAccept?: boolean
  accepting?: boolean
  version?: number
  draft?: string
  draftError?: string
  floating?: boolean
  agentPrompt?: (comment: DropComment) => string
}>()
const emit = defineEmits<{
  submit: [body: string, files: File[], mentions: string[]]
  cancel: []
  resolve: [id: string, resolved: boolean]
  delete: [id: string]
  deleteReply: [id: string, replyId: string]
  copyLink: [comment: DropComment]
  suggest: [text: string]
  accept: [id: string]
}>()
const dropComments = injectDropComments()!
const { user, people, attachmentUrl, can } = dropComments
const accept = COMMENT_IMAGE_TYPES.join(",")

const draft = props.pending ? injectReviewDraft()! : undefined
const body = draft?.body ?? ref("")
if (props.draft && !body.value) body.value = props.draft
const mentions = draft?.mentions ?? ref<string[]>([])
const composerPeople = computed(() => [...people.value, ...(draft?.people.value ?? [])])
const lookup = async (query: string) => {
  const found = await dropComments.users(query)
  return draft ? draft.rememberPeople(found) : found
}
const error = ref<string | undefined>(props.draftError)
watch(body, () => (error.value = undefined))
const files = draft?.images.files ?? ref<File[]>([])
const problem = computed(() => draft?.images.problem.value)

const suggesting = computed(() => props.pending?.suggestion !== undefined)
const suggestion = computed({
  get: () => props.pending?.suggestion ?? "",
  set: (text: string) => emit("suggest", text),
})
const card = useTemplateRef<HTMLElement>("card")
onMounted(() => {
  const field = card.value?.querySelector<HTMLTextAreaElement>(
    suggesting.value ? "[data-suggestion] textarea" : "textarea",
  )
  field?.focus({ preventScroll: true })
  if (suggesting.value) field?.select()
})

function send(submit?: CommentComposerSubmit) {
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
const prompt = computed(() =>
  props.comment && props.agentPrompt && !props.comment.delivery && !props.comment.resolved
    ? props.agentPrompt(props.comment)
    : undefined,
)
const t3Link = computed(() => {
  if (!prompt.value) return undefined
  const url = new URL("https://app.t3.codes/new")
  url.searchParams.set("prompt", prompt.value)
  return url.href
})
const versionTo = useVersionTo()
const state = injectDrop()!
const earlier = computed(() =>
  props.comment && props.version && props.comment.version < props.version
    ? state.drop.data.value?.versions.find((item) => item.version === props.comment!.version)
    : undefined,
)
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
        :error="error || problem"
        :guard="false"
        layout="row"
        size="sm"
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
        :users="lookup"
        :people="composerPeople"
        @cancel="emit('cancel')"
        @submit="send"
      >
        <template v-if="suggesting" #extra>
          <div data-suggestion class="space-y-1 pt-0.5">
            <p class="line-clamp-3 text-sm leading-relaxed">
              <span class="sr-only">Replace </span><del class="redline-del px-1">{{ pending.quote }}</del>
            </p>
            <div class="flex items-end gap-1">
              <UTextarea
                v-model="suggestion"
                aria-label="Suggested text"
                class="min-w-0 flex-1"
                placeholder="Leave empty to delete it"
                :rows="1"
                :ui="{
                  base: 'redline-ins field-sizing-content min-h-[calc(1lh+--spacing(2))] max-h-[calc(6lh+--spacing(2))] rounded-sm px-1 py-1 text-base leading-relaxed placeholder:text-muted sm:text-sm',
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
      size="sm"
      :thread="thread"
      :user="user"
      :users="dropComments.users"
      @close="emit('cancel')"
    >
      <template #actions>
        <UTooltip
          v-if="canAccept && !comment.delivery && comment.suggestion !== null && !comment.resolved"
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
        <template v-if="prompt">
          <UTooltip text="Open in T3 Code">
            <UButton
              aria-label="Open in T3 Code"
              color="neutral"
              data-action="open-in-t3-code"
              rel="noopener noreferrer"
              size="xs"
              target="_blank"
              :to="t3Link"
              variant="ghost"
            >
              <AgentIcon class="size-3.5" kind="agent" name="T3 Code" />
            </UButton>
          </UTooltip>
          <UTooltip text="Copy a prompt for your agent">
            <DropCopyButton
              aria-label="Copy prompt"
              color="neutral"
              data-action="copy-prompt"
              icon="i-mingcute-copy-2-line"
              size="xs"
              :value="prompt"
              variant="ghost"
            />
          </UTooltip>
        </template>
        <UTooltip v-if="!comment.delivery" text="Copy link">
          <UButton
            aria-label="Copy link"
            color="neutral"
            icon="i-mingcute-link-line"
            size="xs"
            variant="ghost"
            @click="emit('copyLink', comment)"
          />
        </UTooltip>
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
      <template #status="{ message, delivery }">
        <ViewerDeliveryStatus :delivery="delivery" :message="message" />
      </template>
      <template v-if="screenshot" #after>
        <ViewerReviewScreenshot :comment="comment" :screenshot="screenshot" />
      </template>
    </CommentThread>
  </div>
</template>

<style scoped>
/* The thread fills the dock or the card: its messages scroll, its reply box stays at the bottom. vite-hub/ui's sm size
   sets the rest: 14px text, the replies' rows, and the soft reply field. */
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
  padding-block: 0.25rem;
}

.drop-comment-card :deep([data-slot="comment-thread-header"]) {
  min-height: 2.75rem;
}

.drop-comment-card :deep([data-slot="comment-thread-title"]) {
  font-size: var(--text-sm);
}
</style>
