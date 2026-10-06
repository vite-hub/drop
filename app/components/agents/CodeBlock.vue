<script setup lang="ts">
// A copyable snippet. The copy button sits on its own strip so long commands never run under it.
const props = withDefaults(defineProps<{ code: string; message?: string }>(), { message: "Copied" })
const toast = useToast()
const copied = ref(false)

async function copy() {
  await navigator.clipboard.writeText(props.code)
  copied.value = true
  toast.add({ title: props.message, icon: "i-lucide-check" })
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="flex items-start rounded-md border border-default bg-muted">
    <pre class="min-w-0 flex-1 overflow-x-auto px-3 py-2.5 font-mono text-xs leading-5 text-highlighted"><code>{{ code }}</code></pre>
    <UButton
      :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
      aria-label="Copy"
      class="m-1 shrink-0"
      color="neutral"
      size="xs"
      variant="ghost"
      @click="copy"
    />
  </div>
</template>
