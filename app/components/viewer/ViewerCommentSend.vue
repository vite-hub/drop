<script setup lang="ts">
import { CommentSend } from "vite-hub/ui"
import { createCommentSend } from "vite-hub/comments/client"
import type { DropComment } from "#shared/types"
import type { DropSend } from "~/utils/comment-send"

// ViteHub's Send segment in the pill's comment track, in Copy prompt's place: Send N hands the threads that wait for an
// answer to the member's agent, and its state takes the button's place. `send` is Drop's Send server
// (app/utils/comment-send.ts).
const props = defineProps<{ drop: string; me: string; comments: DropComment[]; send: DropSend }>()

const make = () =>
  createCommentSend(props.send.transport({ drop: props.drop, me: props.me, comments: () => props.comments }))
const client = shallowRef(make())
watch(
  () => [props.drop, props.me, props.send],
  () => (client.value = make()),
)
// A new comment, a reply, or a resolve changes what Send N carries.
watch(
  () => props.comments.map((thread) => `${thread.id}:${thread.replies.length}:${thread.resolved}`).join(),
  () => void client.value.refresh().catch(() => undefined),
)
</script>

<template>
  <CommentSend :client="client" class="text-xs font-medium" />
</template>
