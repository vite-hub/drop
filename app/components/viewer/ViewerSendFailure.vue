<script setup lang="ts">
import type { CopyValue } from "vite-hub/ui"
import type { SendFailure } from "~/utils/comment-send"

const props = defineProps<{ failure: SendFailure; count: number; prompt?: CopyValue; retrying: boolean }>()
const emit = defineEmits<{ retry: [] }>()
const open = defineModel<boolean>("open", { required: true })

const host = useRequestURL().host
const comments = computed(() =>
  props.count === 1 ? "your comment still waits" : `your ${props.count} comments still wait`,
)
const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
const tried = computed(() =>
  props.failure.tries > 1 ? `Tried ${props.failure.tries}× · last at ${time.format(props.failure.at)}` : "",
)

// Copying the fix turns Retry into the next step, until the dialog closes.
const fixCopied = ref(false)
watch(open, (value) => value || (fixCopied.value = false))

const keyProblem = computed(() =>
  props.failure.cause === "setup" && props.failure.problem === "invalid"
    ? "has a VITEHUB_WEBHOOKS_KEY that isn't 32 bytes in base64"
    : "has no VITEHUB_WEBHOOKS_KEY",
)
const fixPrompt = computed(
  () => `Drop at ${host} can't send review comments to agents: the server ${keyProblem.value}, so pairing an agent fails.

Set VITEHUB_WEBHOOKS_KEY on the host that runs this Drop, as a secret, to 32 random bytes in base64 from \`openssl rand -base64 32\`. On Cloudflare Workers that's \`wrangler secret put VITEHUB_WEBHOOKS_KEY\`; on a VPS or in Docker, the server's environment. Don't print the value. A later change of key disconnects every agent.

When it's set, tell me to press Retry in Drop's review toolbar.`,
)
const adminNote = computed(
  () =>
    `Send doesn't work on Drop at ${host}: the server ${keyProblem.value}, so no one can pair an agent. Set it to the output of \`openssl rand -base64 32\` as a secret on the host. https://${host}/docs/self-host#github`,
)

const title = computed(() => {
  const failure = props.failure
  if (failure.cause === "setup")
    return failure.admin ? "Drop can't send to agents yet" : "Send isn't set up on this Drop"
  if (failure.cause === "agent") return `${failure.agent?.name ?? "Your agent"} didn't take the comments`
  return "Send couldn't start"
})
const docs = "/docs/self-host#github"
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="{ body: 'space-y-3' }">
    <template #description>
      <template v-if="failure.cause === 'setup' && failure.admin">
        This Drop {{ failure.problem === "invalid" ? "has a bad" : "has no" }}
        <code class="font-mono text-[0.85em] text-highlighted">VITEHUB_WEBHOOKS_KEY</code>, so it can't pair an agent.
        Nothing was sent, and {{ comments }}.
      </template>
      <template v-else-if="failure.cause === 'setup'">
        An admin has to finish setting it up. Nothing was sent, and {{ comments }}. Until then, copy the prompt and
        paste it in your agent: it reads them through Drop's MCP.
      </template>
      <template v-else-if="failure.cause === 'agent'">
        The delivery didn't go through, so nothing reached it, and {{ comments }}.
      </template>
      <template v-else> Drop couldn't get a setup code for your agent. Nothing was sent, and {{ comments }}. </template>
    </template>

    <template v-if="failure.cause !== 'setup' || failure.admin" #body>
      <template v-if="failure.cause === 'setup'">
        <p class="text-sm text-muted">
          {{
            fixCopied
              ? "Copied. Paste it in an agent that can reach the host, and press Retry when it says the key is set."
              : "Paste this in an agent that can reach the host, such as the one that deployed Drop."
          }}
        </p>
        <pre
          class="max-h-44 overflow-auto rounded-md bg-muted px-3.5 py-3 font-mono text-xs/5 whitespace-pre-wrap text-toned"
          >{{ fixPrompt }}</pre>
      </template>
      <div v-else class="space-y-1.5 rounded-md bg-muted px-3.5 py-3 text-sm">
        <p v-if="failure.cause === 'agent' && failure.agent?.host" class="font-mono text-xs text-muted">
          {{ failure.agent.host }}
        </p>
        <p class="text-toned">{{ failure.reason }}</p>
      </div>
      <p v-if="tried" class="text-xs text-dimmed tabular-nums">{{ tried }}</p>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <template v-if="failure.cause === 'setup' && failure.admin">
          <UButton
            class="mr-auto"
            color="neutral"
            icon="i-mingcute-book-2-line"
            label="Setup docs"
            size="sm"
            target="_blank"
            :to="docs"
            variant="ghost"
          />
          <template v-if="fixCopied">
            <DropCopyButton color="neutral" size="sm" :value="fixPrompt" variant="ghost">Copy again</DropCopyButton>
            <UButton
              autofocus
              color="neutral"
              icon="i-mingcute-refresh-anticlockwise-1-line"
              label="Retry"
              :loading="retrying"
              size="sm"
              @click="emit('retry')"
            />
          </template>
          <template v-else>
            <UButton
              color="neutral"
              label="Retry"
              :loading="retrying"
              size="sm"
              variant="ghost"
              @click="emit('retry')"
            />
            <DropCopyButton
              autofocus
              color="neutral"
              icon="i-mingcute-copy-2-line"
              size="sm"
              :value="fixPrompt"
              variant="solid"
              @click="fixCopied = true"
            >
              Copy fix prompt
            </DropCopyButton>
          </template>
        </template>

        <template v-else-if="failure.cause === 'setup'">
          <DropCopyButton color="neutral" size="sm" :value="adminNote" variant="ghost"
            >Copy note for admin</DropCopyButton
          >
          <DropCopyButton
            v-if="prompt"
            autofocus
            color="neutral"
            icon="i-mingcute-copy-2-line"
            size="sm"
            :value="prompt"
            variant="solid"
          >
            Copy prompt
          </DropCopyButton>
        </template>

        <template v-else>
          <DropCopyButton v-if="prompt" class="mr-auto" color="neutral" size="sm" :value="prompt" variant="link">
            Copy prompt instead
          </DropCopyButton>
          <UButton
            v-if="failure.cause === 'agent'"
            :autofocus="failure.tries > 1"
            color="neutral"
            label="Open Agents"
            size="sm"
            target="_blank"
            to="/agents"
            :variant="failure.tries > 1 ? 'solid' : 'ghost'"
          />
          <UButton
            :autofocus="failure.cause !== 'agent' || failure.tries < 2"
            color="neutral"
            icon="i-mingcute-refresh-anticlockwise-1-line"
            label="Retry"
            :loading="retrying"
            size="sm"
            :variant="failure.cause === 'agent' && failure.tries > 1 ? 'ghost' : 'solid'"
            @click="emit('retry')"
          />
        </template>
      </div>
    </template>
  </UModal>
</template>
