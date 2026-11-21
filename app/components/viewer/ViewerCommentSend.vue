<script setup lang="ts">
import { CommentSend } from "vite-hub/ui"
import { createCommentSend } from "vite-hub/comments/client"
import type { DropComment } from "#shared/types"
import type { DropSend } from "~/utils/comment-send"

const props = defineProps<{ drop: string; comments: DropComment[]; send: DropSend }>()

const make = () => createCommentSend(props.send.transport(props.drop))
const client = shallowRef(make())
watch(
  () => [props.drop, props.send],
  () => (client.value = make()),
)
watch(
  () => props.comments.map((thread) => `${thread.id}:${thread.replies.length}:${thread.resolved}`).join(),
  () => void client.value.refresh().catch(() => undefined),
)
</script>

<template>
  <CommentSend :client="client" class="text-xs font-medium" />
</template>
