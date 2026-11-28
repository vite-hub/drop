<script setup lang="ts">
import type { Hand } from "../lib/messages"

defineProps<{ current?: Hand; denied?: boolean }>()
const choice = defineModel<Hand>("choice", { default: "press" })
</script>

<template>
  <div class="flex flex-col gap-4">
    <URadioGroup
      v-model="choice"
      variant="card"
      color="neutral"
      legend="Where should the hand show?"
      :ui="{
        legend: 'sr-only',
        fieldset: 'gap-y-3',
        item: 'p-4 has-data-[state=checked]:border-inverted has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-inverted',
      }"
      :items="[
        {
          value: 'press',
          label: 'Only when I press the Drop button',
          description: 'Pages stay as they are until you press Drop in the toolbar.',
        },
        {
          value: 'everywhere',
          label: 'On every page',
          description: 'The hand waits in the corner of every page. Click it to comment.',
        },
      ]"
    >
      <template #label="{ item }">
        <span class="flex items-center gap-2">
          {{ item.label }}
          <UBadge v-if="item.value === 'press'" color="neutral" variant="soft" size="sm" label="Default" />
        </span>
      </template>
    </URadioGroup>

    <p v-if="denied" class="flex gap-2 text-sm text-error" role="alert" data-testid="hand-denied">
      <UIcon name="i-mingcute-warning-line" class="mt-0.5 size-4 shrink-0" />
      <span>Your browser said no, so the hand shows only when you press Drop. You can change this later.</span>
    </p>
    <div
      v-else-if="choice === 'everywhere' && current !== 'everywhere'"
      class="rounded-lg bg-elevated p-4 text-sm"
      data-testid="hand-warning"
    >
      <p class="font-medium text-highlighted">Your browser will warn you next</p>
      <p class="mt-1 text-muted">
        It will say Drop can "read and change all your data on all websites". Browsers say that about every extension
        that shows something on pages. Drop only draws the hand and your comments. It sends nothing until you press
        Send, and then only to your Drop.
      </p>
    </div>
  </div>
</template>
