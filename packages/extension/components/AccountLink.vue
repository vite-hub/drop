<script setup lang="ts">
import { computed } from "vue"
import type { State } from "../lib/messages"
import { hostOf, useConnect } from "../lib/page"
import ConnectProblem from "./ConnectProblem.vue"

const props = defineProps<{ state?: State; unlink?: boolean; busy?: boolean }>()
const emit = defineEmits<{ state: [state: State]; unlink: [] }>()

const state = computed({
  get: () => props.state,
  set: (next) => next && emit("state", next),
})
const { problem, detail, connecting, connect } = useConnect(state)
const host = computed(() => hostOf(props.state?.drop ?? ""))
const who = computed(() => props.state?.account?.name ?? props.state?.account?.email ?? "Your account")
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-3 rounded-lg border border-default p-3">
      <template v-if="state?.account">
        <UAvatar :alt="who" size="md" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-highlighted" data-testid="account">Connected as {{ who }}</p>
          <p class="truncate text-xs text-muted">
            <template v-if="state.account.email && state.account.name">{{ state.account.email }} · </template>
            <span class="font-mono">{{ host }}</span>
          </p>
        </div>
        <UButton
          v-if="unlink"
          color="neutral"
          variant="outline"
          label="Disconnect"
          :loading="busy"
          @click="emit('unlink')"
        />
        <UIcon v-else name="i-mingcute-check-circle-line" class="size-5 shrink-0 text-success" />
      </template>
      <template v-else>
        <UAvatar icon="i-mingcute-user-3-line" size="md" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-highlighted">Not connected</p>
          <p class="truncate text-xs text-muted">Notes can't reach <span class="font-mono">{{ host }}</span> yet.</p>
        </div>
        <UButton color="neutral" label="Connect" :loading="connecting" @click="connect" />
      </template>
    </div>
    <ConnectProblem :problem="problem" :detail="detail" :host="host" />
  </div>
</template>
