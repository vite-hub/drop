<script setup lang="ts">
// Row 1: permissions.request must run inside the click handler, before any await (Firefox drops the gesture otherwise).
import { ref } from "vue"

const result = ref("")
const origin = ref(new URLSearchParams(location.search).get("origin") ?? "https://example.test/*")

function grant() {
  const origins = [origin.value]
  browser.permissions
    .request({ origins })
    .then(async (granted) => {
      const contains = await browser.permissions.contains({ origins })
      result.value = JSON.stringify({ granted, contains })
    })
    .catch((error: Error) => {
      result.value = JSON.stringify({ error: error.message })
    })
}

async function check() {
  const origins = [origin.value]
  result.value = JSON.stringify({ contains: await browser.permissions.contains({ origins }) })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-2">
      <UIcon id="icon" name="i-mingcute-chat-3-line" class="size-6" />
      <span class="text-sm">Drop spike</span>
    </div>
    <div class="flex gap-2">
      <UButton id="grant" label="Grant site" icon="i-mingcute-chat-3-line" @click="grant" />
      <UButton id="check" label="Check" color="neutral" variant="outline" @click="check" />
    </div>
    <pre id="result" class="text-xs">{{ result }}</pre>
  </div>
</template>
