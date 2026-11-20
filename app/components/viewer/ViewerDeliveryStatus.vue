<script setup lang="ts">
// One line under a comment or reply that hasn't reached the server, through vite-hub/ui's `status` slot: after a quiet
// start, a muted "Waiting to send"; a refusal says why, with what the reader can do (deliveryLine). The words stay in
// the message above it until the reader discards them. Retry, Edit and Discard act on the app's outbox
// (useCommentsOutbox), which holds them; the parts' own outbox is the viewer's local copy, which has none.
import type { CommentDelivery, CommentMessage } from "vite-hub/comments/client"
import { deliveryLine, WAITING_NOTICE_MS } from "~/utils/comment-delivery"

// compact: the line alone, for a list row, which opens the thread where the actions are.
const props = defineProps<{ message: CommentMessage; delivery: CommentDelivery; compact?: boolean }>()

const app = useCommentsOutbox()
const route = useRoute()

// The clock moves once, when the quiet start ends; after that only the delivery changes the line.
const now = ref(Date.now())
const quiet = props.message.createdAt + WAITING_NOTICE_MS - now.value
if (quiet > 0) useTimeoutFn(() => (now.value = Date.now()), quiet)
const line = computed(() => deliveryLine(props.delivery, props.message.createdAt, now.value))
const asks = computed(() => !props.compact && line.value && line.value.state !== "waiting")

const editing = ref(false)
const words = ref("")
const problem = ref<string>()
function startEdit() {
  words.value = props.message.body
  problem.value = undefined
  editing.value = true
}
async function save() {
  const body = words.value.trim()
  if (!body) return
  // An edit puts it back in the queue with the new words.
  if (await app.edit(props.message.id, body, props.message.mentions)) editing.value = false
  else problem.value = "It's on its way to the server. Try again in a moment."
}
const retry = () => app.outbox()?.retry(props.message.id)
async function discard() {
  if (!(await app.discard(props.message.id))) problem.value = "It's on its way to the server. Try again in a moment."
}
const signIn = computed(() => ({ path: "/signin", query: { redirect: route.fullPath } }))
</script>

<template>
  <div v-if="line" class="mt-1 text-xs" data-delivery :data-state="line.state">
    <form v-if="editing" class="space-y-1.5" @submit.prevent="save">
      <UTextarea
        v-model="words"
        aria-label="Edit the comment"
        autofocus
        autoresize
        class="w-full"
        :maxrows="6"
        :rows="2"
        size="sm"
        @keydown.enter.exact.prevent="save"
        @keydown.esc.stop.prevent="editing = false"
      />
      <div class="flex items-center gap-1">
        <UButton color="neutral" label="Send" size="xs" type="submit" variant="soft" :disabled="!words.trim()" />
        <UButton color="neutral" label="Cancel" size="xs" variant="ghost" @click="editing = false" />
      </div>
    </form>
    <div v-else class="flex flex-wrap items-center gap-x-2 gap-y-0.5" :role="asks ? 'alert' : 'status'">
      <span
        class="flex min-w-0 items-center gap-1"
        :class="line.state === 'gone' || line.state === 'refused' ? 'text-error' : 'text-muted'"
      >
        <UIcon
          :name="line.state === 'gone' || line.state === 'refused' ? 'i-mingcute-warning-line' : 'i-mingcute-time-line'"
          class="size-3.5 shrink-0"
        />
        <span v-if="compact || line.state !== 'sign-in'" class="text-pretty">{{ line.text }}</span>
      </span>
      <template v-for="action in compact ? [] : line.actions" :key="action">
        <UButton
          v-if="action === 'sign-in'"
          class="p-0"
          color="neutral"
          :label="line.text"
          size="xs"
          :to="signIn"
          variant="link"
        />
        <UButton
          v-else-if="action === 'retry'"
          class="p-0"
          color="neutral"
          label="Send again"
          size="xs"
          variant="link"
          @click="retry"
        />
        <DropCopyButton
          v-else-if="action === 'copy'"
          class="p-0"
          color="neutral"
          label="Copy"
          size="xs"
          :value="message.body"
          variant="link"
        />
        <UButton
          v-else-if="action === 'edit'"
          class="p-0"
          color="neutral"
          label="Edit"
          size="xs"
          variant="link"
          @click="startEdit"
        />
        <UButton
          v-else-if="action === 'discard'"
          class="p-0"
          color="neutral"
          label="Discard"
          size="xs"
          variant="link"
          @click="discard"
        />
      </template>
    </div>
    <p v-if="problem" class="mt-1 text-error">{{ problem }}</p>
  </div>
</template>
