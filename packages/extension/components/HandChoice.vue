<script setup lang="ts">
import { computed, ref } from "vue"
import type { Hand } from "../lib/messages"
import { allowEverywhere } from "../lib/page"

const props = defineProps<{ hand?: Hand; busy?: boolean }>()
const emit = defineEmits<{ change: [hand: Hand] }>()
const denied = ref(false)

const items = [
  { value: "press", label: "When I press Drop", description: "Nothing runs on a site until you press it." },
  { value: "everywhere", label: "On every page", description: "Drop asks to read and change every site." },
]
const value = computed(() => props.hand ?? "press")

async function choose(next: unknown) {
  denied.value = false
  if (next === "press") emit("change", "press")
  else if (next !== "everywhere") return
  else if (await allowEverywhere()) emit("change", "everywhere")
  else denied.value = true
}
</script>

<template>
  <UFormField label="Where the hand shows" :error="denied ? 'Drop stays where you press it.' : undefined">
    <URadioGroup :model-value="value" :items="items" :disabled="busy" @update:model-value="choose" />
  </UFormField>
</template>
