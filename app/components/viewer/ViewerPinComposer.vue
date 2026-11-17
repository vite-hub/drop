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
const body = computed({
  get: () => draft.body.value,
  set: (value) => {
    if (!busy.value) draft.body.value = value
  },
})
const mentions = computed({
  get: () => draft.mentions.value,
  set: (value) => {
    if (!busy.value) draft.mentions.value = value
  },
})
const files = computed({
  get: () => draft.images.files.value,
  set: (value) => {
    if (!busy.value) draft.images.files.value = value
  },
})
const lookup = async (query: string) => draft.rememberPeople(await users(query))
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
  <div data-comment-editor data-pin-composer>
    <CommentComposer
      v-model="body"
      v-model:files="files"
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
      :users="lookup"
      :people="draft.people.value"
      @cancel="emit('cancel')"
      @submit="send"
    />
  </div>
</template>

<style>
/* Keep lookup results in the measured card so both floating scroll containers grow to expose them. */
[data-pin-composer] [data-slot="comment-composer-mentions"] {
  position: static;
  margin-top: 0.25rem;
}
</style>
