<script setup lang="ts">
import { CommentSend, useCopy, type CopyValue } from "vite-hub/ui"
import { createCommentSend, type CommentSendState } from "vite-hub/comments/client"
import type { DropComment } from "#shared/types"
import type { DropSend, SendFailure, SendFailureDetails } from "~/utils/comment-send"

const props = defineProps<{ drop: string; comments: DropComment[]; send: DropSend; prompt?: CopyValue }>()
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

const state = shallowRef<CommentSendState>(client.value.state)
const failure = shallowRef<SendFailure | null>(null)
const shown = shallowRef<SendFailure | null>(null)
const open = ref(false)
let asked = 0

async function explain(from: CommentSendState["status"], result: Extract<CommentSendState, { status: "failed" }>) {
  const ask = ++asked
  const { reason, problem, agent } = result
  let next: SendFailureDetails = { cause: "request", reason }
  if (problem === "delivery") next = { cause: "agent", reason, agent: agent ?? null }
  else if (problem || from !== "sending") {
    const setup = await props.send.setup().catch(() => null)
    if (setup?.problem) next = { cause: "setup", problem: setup.problem, admin: setup.admin }
    else if (setup && problem === "key-invalid") next = { cause: "reconnect", reason }
  }
  if (ask !== asked || client.value.state.status !== "failed") return
  const tries = failure.value?.cause === next.cause ? failure.value.tries + 1 : 1
  failure.value = shown.value = { ...next, tries, at: Date.now() }
  open.value = true
}

watch(
  client,
  (current, _, onCleanup) => {
    asked++
    failure.value = null
    open.value = false
    let last = current.state
    state.value = last
    onCleanup(
      current.onChange(() => {
        const next = current.state
        const recount = last.status === "failed" && next.status === "failed" && last.count !== next.count
        if (next.status === "failed" && !recount) void explain(last.status, next)
        if (next.status !== "failed" && next.status !== "sending") {
          asked++
          failure.value = null
          open.value = false
        }
        last = state.value = next
      }),
    )
  },
  { immediate: true },
)

const { copy } = useCopy()
const retrying = ref(false)
async function retry() {
  retrying.value = true
  try {
    await client.value.send((prompt) => copy(() => prompt))
  } finally {
    retrying.value = false
  }
}

const explained = computed(() => (state.value.status === "failed" ? failure.value : null))
const setup = computed(() => explained.value?.cause === "setup")
const waiting = computed(() => `${state.value.count} ${state.value.count === 1 ? "comment" : "comments"}`)
const label = computed(() => {
  const current = explained.value
  if (!current) return ""
  if (current.cause === "reconnect") return "Reconnect agent"
  if (current.cause === "request") return "Send failed"
  return current.tries > 1 ? `Not delivered · ${current.tries}×` : "Not delivered"
})
</script>

<template>
  <div class="flex items-center" :data-explained="explained ? '' : undefined">
    <div v-if="setup" class="text-xs font-medium" data-slot="comment-send">
      <span data-slot="comment-send-content">
        <button
          :aria-label="`Send: ${waiting}`"
          data-action="send"
          data-slot="comment-send-action"
          :title="`Send ${waiting} that wait for an answer to your agent`"
          type="button"
          @click="retry"
        >
          <UIcon aria-hidden="true" class="vh-comment-send-icon" name="i-lucide-send" />
          Send
          <span data-slot="comment-send-count">{{ state.count }}</span>
        </button>
      </span>
    </div>
    <UButton
      v-else-if="explained"
      :aria-label="`${label}: see why`"
      aria-haspopup="dialog"
      class="[animation:pop-in_200ms_var(--ease-out)]"
      color="error"
      icon="i-mingcute-alert-octagon-line"
      size="xs"
      trailing-icon="i-mingcute-right-small-line"
      variant="ghost"
      @click="open = true"
    >
      <span class="max-sm:hidden">{{ label }}</span>
    </UButton>
    <CommentSend v-show="!setup" :client="client" class="text-xs font-medium" />
    <ViewerSendFailure
      v-if="shown"
      v-model:open="open"
      :count="state.count"
      :failure="shown"
      :prompt="prompt"
      :retrying="retrying"
      @retry="retry"
    />
  </div>
</template>

<style scoped>
/* Drop's button above says why, so ViteHub's Not delivered goes; its Retry stays. When the server isn't set up,
   Drop draws a plain Send in its place, and pressing it tries again and opens the dialog. */
[data-explained] :deep([data-slot="comment-send-status"]) {
  display: none;
}
</style>
