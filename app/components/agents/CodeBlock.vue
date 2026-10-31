<script setup lang="ts">
// A copyable snippet. The copy button sits on its own strip so long commands never run under it, and turns into a
// check once it copied.
const { code } = defineProps<{ code: string }>()
const { copy: copyText, copied } = useCopy()
const copy = () => copyText(code)
</script>

<template>
  <div class="flex items-start rounded-md border border-default bg-muted">
    <pre
      class="min-w-0 flex-1 overflow-x-auto px-3 py-2.5 font-mono text-xs leading-5 text-highlighted"
    ><code>{{ code }}</code></pre>
    <UButton
      :icon="copied() ? 'i-mingcute-check-line' : 'i-mingcute-copy-2-line'"
      :ui="{ leadingIcon: copied() ? 'animate-icon-in' : undefined }"
      aria-label="Copy"
      class="m-1 shrink-0"
      color="neutral"
      size="xs"
      variant="ghost"
      @click="copy"
    />
  </div>
</template>
