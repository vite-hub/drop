<script setup lang="ts">
// The Pin style's composer: one line beside the draft's pin that grows with the text, to about 168px. Enter sends,
// Shift+Enter breaks the line, Escape drops it. The words are the review draft's, so they follow the reader to other
// text they select.
const emit = defineEmits<{ submit: [body: string]; cancel: [] }>()
const draft = injectReviewDraft()!
const field = useTemplateRef<HTMLTextAreaElement>("field")
const error = ref<string>()
const busy = computed(() => draft.sending.value || draft.waiting.value)
const empty = computed(() => !draft.body.value.trim())

// Sized to its text by hand: field-sizing isn't in every browser yet.
function fit() {
  const el = field.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = `${Math.min(el.scrollHeight, 168)}px`
}
watch(draft.body, () => {
  error.value = undefined
  void nextTick(fit)
})
onMounted(fit)

function send() {
  if (busy.value || empty.value) return
  emit("submit", draft.body.value)
}
function key(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    send()
  } else if (event.key === "Escape") {
    event.preventDefault()
    event.stopPropagation()
    emit("cancel")
  }
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
    <div class="flex items-end gap-1.5 py-1.5 pr-1.5 pl-3.5">
      <textarea
        ref="field"
        v-model="draft.body.value"
        aria-label="Comment"
        class="min-h-7 flex-1 resize-none bg-transparent py-0.5 text-base/6 text-highlighted outline-none placeholder:text-dimmed sm:text-sm/6"
        placeholder="Comment, ↵ to send"
        rows="1"
        @keydown="key"
      />
      <UButton
        aria-label="Send comment"
        class="shrink-0 rounded-full"
        :disabled="empty"
        icon="i-mingcute-arrow-up-line"
        :loading="busy"
        size="sm"
        @click="send"
      />
    </div>
    <p v-if="error" role="alert" class="px-3.5 pb-2 text-xs text-error">{{ error }}</p>
  </div>
</template>
