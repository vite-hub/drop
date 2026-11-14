<script setup lang="ts">
// A new comment's composer as one small surface beside what it's on: ViteHub's CommentComposer as a row, so it reads
// and works as the box in the dock does. Enter sends, Shift+Enter breaks the line, Escape drops it, "@" names people.
// The words and pictures are the review draft's, so they follow the reader to other text they select. A picture can
// still come in: the one the frame takes of a tooltip under an area, or one pasted or dropped into the box.
// Comment or Suggest is picked before it opens (the selection bar, C or E); a suggestion gets the full composer.
import { CommentComposer, type CommentComposerSubmit } from "vite-hub/ui"
import { COMMENT_IMAGE_TYPES } from "#shared/schemas"

const emit = defineEmits<{ submit: [body: string, files: File[], mentions: string[]]; cancel: [] }>()
const draft = injectReviewDraft()!
const { user, users } = injectDropComments()!
const mentions = ref<string[]>([])
const error = ref<string>()
watch(draft.body, () => (error.value = undefined))
const busy = computed(() => draft.sending.value || draft.waiting.value)

function send(sent: CommentComposerSubmit) {
  if (!busy.value) emit("submit", sent.body, sent.files, sent.mentions)
}
defineExpose({
  fail: async (reason?: string, text?: string) => {
    if (text && !draft.body.value) draft.body.value = text
    error.value = reason ?? "Couldn't send. Try again."
  },
})
</script>

<template>
  <div data-comment-editor>
    <CommentComposer
      v-model="draft.body.value"
      v-model:files="draft.images.files.value"
      v-model:mentions="mentions"
      :accept="COMMENT_IMAGE_TYPES.join(',')"
      allow-empty
      :autofocus="false"
      :busy="busy"
      :error="error || draft.images.problem.value"
      :guard="false"
      layout="row"
      placeholder="Comment, ↵ to send"
      size="sm"
      :user="user"
      :users="users"
      @cancel="emit('cancel')"
      @submit="send"
    />
  </div>
</template>
