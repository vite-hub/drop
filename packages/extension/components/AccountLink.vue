<script setup lang="ts">
import { ref } from "vue"
import type { State } from "../lib/messages"
import { allowDrop } from "../lib/page"

const props = defineProps<{ state?: State; busy?: boolean; unlink?: boolean }>()
const emit = defineEmits<{ connect: []; unlink: [] }>()
const denied = ref(false)

async function connect() {
  denied.value = false
  if (!props.state) return
  if (await allowDrop(props.state.drop)) emit("connect")
  else denied.value = true
}
</script>

<template>
  <div class="flex items-center justify-between gap-3">
    <div v-if="state?.account" class="min-w-0">
      <p class="truncate text-sm font-medium" data-testid="account">{{ state.account.name ?? state.account.email }}</p>
      <p class="truncate text-xs text-muted">{{ state.dropName ?? state.drop }}</p>
    </div>
    <div v-else class="min-w-0">
      <p class="text-sm">Not connected</p>
      <p v-if="denied" class="text-xs text-error">Drop needs to reach your Drop to connect.</p>
      <p v-else class="truncate text-xs text-muted">{{ state?.dropName ?? state?.drop }}</p>
    </div>
    <UButton v-if="state?.account && unlink" color="neutral" variant="outline" label="Unlink" @click="emit('unlink')" />
    <UButton v-else-if="!state?.account" :loading="busy" label="Connect" @click="connect" />
  </div>
</template>
