<script setup lang="ts">
import { CommentSend, useCopy, type CopyValue } from "vite-hub/ui"
import { createCommentSend, type CommentSendState } from "vite-hub/comments/client"
import type { DropComment } from "#shared/types"
import type { DropSend, SendFailure } from "~/utils/comment-send"

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

async function explain(from: CommentSendState["status"], reason: string) {
  const ask = ++asked
  const next =
    from === "sending"
      ? ({ cause: "agent", reason, agent: (await props.send.endpoint().catch(() => null))?.agent ?? null } as const)
      : await props.send.setup().then(
          ({ problem, admin }) =>
            problem ? ({ cause: "setup", problem, admin } as const) : ({ cause: "pairing", reason } as const),
          () => ({ cause: "pairing", reason }) as const,
        )
  if (ask !== asked || client.value.state.status !== "failed") return
  const tries = failure.value?.cause === next.cause ? failure.value.tries + 1 : 1
  failure.value = shown.value = { ...next, tries, at: Date.now() }
  open.value = true
}

watch(
  client,
  (current, _, onCleanup) => {
    let last = current.state
    state.value = last
    onCleanup(
      current.onChange(() => {
        const next = current.state
        const recount = last.status === "failed" && next.status === "failed" && last.count !== next.count
        if (next.status === "failed" && !recount) void explain(last.status, next.reason)
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
const label = computed(() => {
  const current = explained.value
  if (!current) return ""
  if (current.cause === "setup") return "Send needs setup"
  return current.tries > 1 ? `Not delivered · ${current.tries}×` : "Not delivered"
})
</script>

<template>
  <div class="flex items-center" :data-explained="explained ? '' : undefined">
    <UButton
      v-if="explained"
      :aria-label="`${label}: see why`"
      aria-haspopup="dialog"
      class="[animation:pop-in_200ms_var(--ease-out)]"
      :color="explained.cause === 'setup' ? 'warning' : 'error'"
      icon="i-mingcute-alert-octagon-line"
      size="xs"
      trailing-icon="i-mingcute-right-small-line"
      variant="ghost"
      @click="open = true"
    >
      <span class="max-sm:hidden">{{ label }}</span>
    </UButton>
    <CommentSend :client="client" class="text-xs font-medium" />
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
/* Drop's button above says why, so ViteHub's Not delivered goes; its Retry stays. */
[data-explained] :deep([data-slot="comment-send-status"]) {
  display: none;
}
</style>
