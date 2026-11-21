<script setup lang="ts">
import { CommentPanel } from "vite-hub/ui"
import { COMMENT_IMAGE_TYPES } from "#shared/schemas"
import type { DropComment, SiteReviewItem } from "#shared/types"

const props = defineProps<{
  comments: DropComment[]
  canComment: boolean
  outdated: Set<string>
  screenshots?: Map<string, SiteReviewItem["screenshot"]>
}>()
const emit = defineEmits<{ focus: [comment: DropComment] }>()
const { comments: state, people, upload, attachmentUrl, can } = injectDropComments()!
const root = useTemplateRef<HTMLElement>("root")
defineExpose({
  focusComposer: () => root.value?.querySelector<HTMLElement>("[data-slot='comment-panel-composer'] textarea")?.focus(),
  focusComment: (id: string) =>
    root.value?.querySelector<HTMLButtonElement>(`[data-thread-id="${CSS.escape(id)}"]`)?.focus(),
})

const suggestions = computed(() => {
  const rows = new Map<string, { quote: string; suggestion: string }>()
  for (const { id, quote, suggestion } of props.comments)
    if (quote && suggestion !== null) rows.set(id, { quote, suggestion })
  return rows
})

const group = (thread: { id: string; status: string }) =>
  thread.status === "open" && props.outdated.has(thread.id) ? "From earlier versions" : undefined

const screenshotOf = (id: string) => props.screenshots?.get(id) ?? null
const shotOf = (id: string) =>
  props.comments
    .find((item) => item.id === id)
    ?.attachments.find((file) => file.contentType.startsWith("image/") && file.filename.startsWith("screenshot."))

function select(thread: { id: string }) {
  const comment = props.comments.find((item) => item.id === thread.id)
  if (comment) emit("focus", comment)
}
</script>

<template>
  <div ref="root" class="flex min-h-0 flex-1 flex-col">
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
    >
      <template #list-actions><slot name="actions" /></template>
      <template #preview="{ thread, text }">
        <ViewerSuggestion v-if="!text && suggestions.has(thread.id)" v-bind="suggestions.get(thread.id)!" inline />
        <template v-else-if="screenshotOf(thread.id)">
          <span v-if="text" class="line-clamp-2">{{ text }}</span>
          <ViewerScreenshotImage
            data-review-thumb
            class="mt-1.5 max-h-24 w-fit"
            :comment="comments.find((item) => item.id === thread.id)!"
            :url="screenshotOf(thread.id)!.url"
          />
        </template>
        <template v-else-if="shotOf(thread.id)">
          <span v-if="text" class="line-clamp-2">{{ text }}</span>
          <img
            data-review-thumb
            :src="shotOf(thread.id)!.url"
            :alt="`Screenshot for comment ${thread.n}`"
            class="mt-1.5 block max-h-24 max-w-full rounded-sm object-contain outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
            loading="lazy"
          />
        </template>
        <template v-else>{{ text }}</template>
        <ViewerDeliveryStatus
          v-if="thread.delivery && thread.messages[0]"
          compact
          :delivery="thread.delivery"
          :message="thread.messages[0]"
        />
      </template>
    </CommentPanel>
  </div>
</template>
