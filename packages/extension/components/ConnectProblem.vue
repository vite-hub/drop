<script setup lang="ts">
import type { ConnectProblem } from "../lib/page"

defineProps<{ problem?: ConnectProblem; detail?: string; host: string }>()
</script>

<template>
  <p v-if="problem" class="flex gap-2 text-sm text-error" role="alert" data-testid="connect-problem">
    <UIcon name="i-mingcute-warning-line" class="mt-0.5 size-4 shrink-0" />
    <span v-if="problem === 'permission'">
      Your browser didn't let Drop talk to <span class="font-mono">{{ host }}</span>, so it can't connect. Press Connect
      and choose Allow.
    </span>
    <span v-else-if="problem === 'closed'">
      The Drop window closed before you chose Allow. Press Connect to try again.
    </span>
    <span v-else-if="problem === 'denied'">
      You chose not to connect this browser in Drop. Press Connect if you change your mind.
    </span>
    <span v-else>Couldn't connect: {{ detail }}</span>
  </p>
</template>
