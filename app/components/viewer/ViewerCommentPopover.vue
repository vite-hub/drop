<script setup lang="ts">
// New comments: a one-line composer (Enter sends, Shift+Enter breaks). The selection stays highlighted
// in the document, so the composer doesn't repeat it. Existing comments: the thread with resolve/delete.
import { useTimestamp } from "@vueuse/core"
import type { DropComment, NewComment } from "#shared/types"

export type PendingComment = Omit<NewComment, "body">

const props = defineProps<{ x: number; y: number; pending?: PendingComment; comment?: DropComment; canManage: boolean }>()
const emit = defineEmits<{ submit: [body: string]; cancel: []; resolve: [id: string, resolved: boolean]; delete: [id: string] }>()
const body = ref("")
const busy = ref(false)
const input = useTemplateRef<HTMLTextAreaElement>("input")
const now = useTimestamp({ interval: 30_000 })
const width = 320
const style = computed(() => {
  const left = Math.min(Math.max(8, props.x), window.innerWidth - width - 8)
  const top = Math.min(Math.max(56, props.y + 8), window.innerHeight - 240)
  return { left: `${left}px`, top: `${top}px`, width: `${width}px` }
})
onMounted(() => input.value?.focus())

function send() {
  if (!body.value.trim() || busy.value) return
  busy.value = true
  emit("submit", body.value)
}
defineExpose({ fail: () => (busy.value = false) })
</script>

<template>
  <div class="fixed inset-0 z-40" @click="emit('cancel')" />
  <div
    class="fixed z-50 origin-top-left rounded-xl border border-default bg-default text-default shadow-lg shadow-black/5 [animation:pop-in_160ms_var(--ease-out)]"
    :class="pending ? 'p-1.5 pl-2.5' : 'space-y-2.5 p-3'"
    :style="style"
  >
    <div v-if="pending" class="flex items-end gap-2">
      <textarea
        ref="input"
        v-model="body"
        aria-label="Comment"
        class="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm leading-relaxed text-highlighted outline-none [field-sizing:content] placeholder:text-dimmed"
        :placeholder="pending.quote ? 'Comment on the selection' : 'Comment on this spot'"
        rows="1"
        @keydown.enter.exact.prevent="send"
        @keydown.esc="emit('cancel')"
      />
      <UButton aria-label="Send comment" class="size-8 justify-center rounded-full" color="neutral" :disabled="!body.trim()" icon="i-lucide-arrow-up" :loading="busy" @click="send" />
    </div>
    <template v-else-if="comment">
      <ViewerCommentHeader :comment="comment" :now="now" />
      <p v-if="comment.quote" class="line-clamp-3 border-l-2 border-default pl-2.5 text-[13px] text-muted">{{ comment.quote }}</p>
      <p class="text-sm whitespace-pre-wrap">{{ comment.body }}</p>
      <div v-if="canManage || comment.mine" class="flex justify-end gap-1.5">
        <UButton aria-label="Delete comment" color="neutral" icon="i-lucide-trash" size="sm" variant="ghost" @click="emit('delete', comment.id)" />
        <UButton
          color="neutral"
          :icon="comment.resolved ? 'i-lucide-undo-2' : 'i-lucide-check'"
          :label="comment.resolved ? 'Reopen' : 'Resolve'"
          size="sm"
          variant="outline"
          @click="emit('resolve', comment.id, !comment.resolved)"
        />
      </div>
    </template>
  </div>
</template>
