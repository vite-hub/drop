<script setup lang="ts">
// The review dock's list: vite-hub/ui's CommentPanel, docked, over the drop's comments (useDropComments). Open and
// Resolved switch it; the box at the bottom comments on the page as a whole, with images and "@" for people who may read
// the drop. A row opens its thread where the viewer shows threads, beside its pin. Open comments whose text or element
// this version no longer has sit apart, under "From earlier versions" (`outdated` in DropViewer.vue).
import { CommentPanel } from "vite-hub/ui/comments"
import { COMMENT_IMAGE_TYPES } from "#shared/schemas"
import type { DropComment } from "#shared/types"

const props = defineProps<{ comments: DropComment[]; canComment: boolean; outdated: Set<string> }>()
const emit = defineEmits<{ focus: [comment: DropComment] }>()
const { comments: state, people, upload, attachmentUrl, can } = injectDropComments()!
const root = useTemplateRef<HTMLElement>("root")
defineExpose({
  focusComposer: () => root.value?.querySelector<HTMLElement>("[data-slot='comment-panel-composer'] textarea")?.focus(),
  focusComment: (id: string) =>
    root.value?.querySelector<HTMLButtonElement>(`[data-thread-id="${CSS.escape(id)}"]`)?.focus(),
})

const group = (thread: { id: string; status: string }) =>
  thread.status === "open" && props.outdated.has(thread.id) ? "From earlier versions" : undefined

function select(thread: { id: string }) {
  const comment = props.comments.find((item) => item.id === thread.id)
  if (comment) emit("focus", comment)
}
</script>

<template>
  <div ref="root" class="drop-comment-panel flex min-h-0 flex-1 flex-col">
    <CommentPanel
      :accept="COMMENT_IMAGE_TYPES.join(',')"
      :attachment-url="attachmentUrl"
      :can="can"
      :comments="state"
      :group="group"
      :people="people"
      :read-only="!canComment"
      :thread="null"
      :upload="upload"
      variant="docked"
      @select="select"
    />
  </div>
</template>

<style scoped>
/* The dock's own heading names the list. */
.drop-comment-panel :deep([data-slot="comment-panel-title"]) {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
