<script setup lang="ts">
import { ref, watch } from "vue"
import { allowDrop } from "../lib/page"

const props = defineProps<{ drop?: string; busy?: boolean; error?: string; label?: string }>()
const emit = defineEmits<{ save: [drop: string] }>()

const address = ref(props.drop ?? "")
const denied = ref(false)
watch(
  () => props.drop,
  (drop) => {
    if (drop) address.value = drop
  },
)

async function save() {
  denied.value = false
  const drop = address.value
  const answer = await allowDrop(drop).then(
    (granted) => (granted ? "granted" : "denied"),
    () => "not-an-address",
  )
  if (answer === "denied") denied.value = true
  else emit("save", drop)
}
</script>

<template>
  <form class="flex flex-col gap-2" @submit.prevent="save">
    <UFormField label="Drop address" :error="denied ? 'Drop needs to reach this address to connect.' : error">
      <UInput v-model="address" class="w-full font-mono" placeholder="https://drop.example.com" spellcheck="false" />
    </UFormField>
    <div>
      <UButton type="submit" :loading="busy" :label="label ?? 'Save'" />
    </div>
  </form>
</template>
