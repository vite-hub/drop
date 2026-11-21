<script setup lang="ts">
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
const busy = computed(() => draft.waiting.value)

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
      frame="none"
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
