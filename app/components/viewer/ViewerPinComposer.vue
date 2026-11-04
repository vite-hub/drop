<script setup lang="ts">
// A new comment's composer as one small surface beside what it's on: a line that grows with the text, to about 168px,
// and a send button. No avatar and no field inside a card. Enter sends, Shift+Enter breaks the line, Escape drops it.
// The words and pictures are the review draft's, so they follow the reader to other text they select. A picture can
// still come in: the one the frame takes of a tooltip under an area, or one pasted into the line; each shows above it.
const emit = defineEmits<{ submit: [body: string, files: File[]]; cancel: [] }>()
const draft = injectReviewDraft()!
const field = useTemplateRef<HTMLTextAreaElement>("field")
const error = ref<string>()
const busy = computed(() => draft.sending.value || draft.waiting.value)
const pictures = computed(() => draft.images.picks.value)
const empty = computed(() => !draft.body.value.trim() && !pictures.value.length)

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
  emit("submit", draft.body.value, draft.images.files.value)
}
function key(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    send()
  } else if (event.key === "Escape") {
    event.preventDefault()
    event.stopPropagation()
    if (!busy.value) emit("cancel")
  }
}
function paste(event: ClipboardEvent) {
  if (busy.value) return event.preventDefault()
  const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"))
  if (!files.length) return
  event.preventDefault()
  draft.images.add(files)
}
defineExpose({
  fail: async (reason?: string, text?: string) => {
    if (text && !draft.body.value) draft.body.value = text
    error.value = reason ?? "Couldn't send. Try again."
  },
})
</script>

<template>
  <form data-comment-editor @submit.prevent="send">
    <div v-if="pictures.length" class="flex flex-wrap gap-1.5 px-3 pt-3">
      <span v-for="pick in pictures" :key="pick.url" class="group relative">
        <img
          :src="pick.url"
          alt="Attached picture"
          class="size-10 rounded-md object-cover outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        />
        <button
          aria-label="Remove picture"
          class="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-inverted text-inverted shadow-sm"
          :disabled="busy"
          type="button"
          @click="draft.images.remove(pick)"
        >
          <UIcon name="i-mingcute-close-line" class="size-3" />
        </button>
      </span>
    </div>
    <div class="flex items-end gap-1.5 py-1.5 pr-1.5 pl-3.5">
      <textarea
        ref="field"
        v-model="draft.body.value"
        aria-label="Comment"
        class="min-h-7 flex-1 resize-none bg-transparent py-0.5 text-base/6 text-highlighted outline-none placeholder:text-dimmed sm:text-sm/6"
        placeholder="Comment, ↵ to send"
        :readonly="busy"
        rows="1"
        @keydown="key"
        @paste="paste"
      />
      <UButton
        aria-label="Send comment"
        class="shrink-0 rounded-full"
        :disabled="empty"
        icon="i-mingcute-arrow-up-line"
        :loading="busy"
        size="sm"
        type="submit"
      />
    </div>
    <p v-if="error" role="alert" class="px-3.5 pb-2 text-xs text-error">{{ error }}</p>
  </form>
</template>
