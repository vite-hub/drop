<script setup lang="ts">
// Opening the popup from the toolbar grants activeTab. Run the per-tab checks right away.
import { onMounted, ref } from "vue"

const result = ref("")

onMounted(async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return
  const reply = await browser.runtime.sendMessage({ type: "popup-run", tabId: tab.id, windowId: tab.windowId })
  result.value = JSON.stringify(reply)
})
</script>

<template>
  <UApp>
    <main class="w-72 p-4">
      <UButton label="Review this page" icon="i-mingcute-chat-3-line" block />
      <pre id="result" class="mt-2 text-xs">{{ result }}</pre>
    </main>
  </UApp>
</template>
